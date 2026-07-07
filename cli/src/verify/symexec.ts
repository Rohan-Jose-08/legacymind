/**
 * Layer C — path-sensitive symbolic execution.
 *
 * Where layer A samples the input space, layer C *derives* the inputs that
 * matter by executing the IR symbolically, then checks them differentially:
 *
 *   1. Affine symbolic execution — PERFORMs are inlined from the CFG entry
 *      and every statement is executed over an exact-rational affine store:
 *      each variable is c0 + Σ ci·xi over the stdin inputs. IF forks carry
 *      their condition as an affine constraint (variable-vs-variable
 *      conditions included), so every enumerated path has a solvable
 *      constraint system, not just a label.
 *   2. Rounding and truncating stores are not linear; instead of going
 *      opaque they carry a *fuzz bound* — an exact bound on how far the
 *      stored value can drift from its affine form (½ulp per ROUNDED store,
 *      1ulp per truncation). Constraints are then satisfied only with a
 *      margin beyond the fuzz: sound, and honest when the margin cannot be
 *      established.
 *   3. Obligations:
 *        - branch boundaries: for each affine condition, the inputs that
 *          land the decision value exactly on / one ulp either side of the
 *          boundary — solved through derived-variable chains (accumulators
 *          included) by linear equation solving on the PICTURE grid;
 *        - rounding half-boundaries: for each money-touching ROUNDED store
 *          of an affine expression, the inputs that land the product
 *          exactly on a half-unit at the target scale, by affine
 *          congruence solving (x·k ≡ m/2 (mod m) generalized with fixed
 *          terms). Nonlinear forms (variable × variable) fall back to the
 *          v1 producer-inversion heuristic and are disclosed either way.
 *   4. Path witnesses: each path's constraint system is solved outright so
 *      coverage is a first-class result, not a side effect of obligations.
 *   5. Every realized case runs through the differential harness; any
 *      diverging case is a FAIL.
 *
 * Loops (GO TO, PERFORM UNTIL/VARYING) are still outside this engine —
 * they need fixpoint/unrolling machinery and are rejected upstream by the
 * parser. Everything the solver cannot realize is surfaced, never skipped.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DataItem, ModuleIR, Paragraph, Statement } from "../parse/parser.js";
import {
  DiffExecError,
  loadConfig,
  runCase,
  artifactHash,
  type CaseResult,
  type DiffConfig,
} from "./diffexec.js";
import { findItem } from "./propgen.js";

const DEFAULT_MONEY_PATTERN = "PAY|TAX|GROSS|NET|AMT|AMOUNT|BAL|FEE|INT|PRICE|COST|RATE";
const MAX_PATHS = 64;

type ComputeStmt = Extract<Statement, { kind: "compute" }>;

// ---------------------------------------------------------------------------
// Exact rational arithmetic (BigInt fractions; no floats anywhere).
// ---------------------------------------------------------------------------

interface Rat {
  n: bigint;
  d: bigint; // > 0, gcd(|n|, d) = 1
}

const R0: Rat = { n: 0n, d: 1n };
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b));

function rat(n: bigint, d: bigint): Rat {
  if (d === 0n) throw new DiffExecError("layer C: rational division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return g === 0n ? { n: 0n, d: 1n } : { n: n / g, d: d / g };
}

/** Parse a plain decimal string ("502.00", "0.0025", ".225", "15") exactly. */
function ratOf(text: string): Rat | null {
  const m = /^(-?)(\d*)(?:\.(\d+))?$/.exec(text.trim());
  if (!m || (!m[2] && !m[3])) return null;
  const sign = m[1] === "-" ? -1n : 1n;
  const frac = m[3] ?? "";
  return rat(sign * BigInt((m[2] || "0") + frac), 10n ** BigInt(frac.length));
}

const rAdd = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const rSub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const rMul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
const rDiv = (a: Rat, b: Rat): Rat => rat(a.n * b.d, a.d * b.n);
const rNeg = (a: Rat): Rat => ({ n: -a.n, d: a.d });
const rAbs = (a: Rat): Rat => ({ n: a.n < 0n ? -a.n : a.n, d: a.d });
const rCmp = (a: Rat, b: Rat): number => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
const rIsZero = (a: Rat): boolean => a.n === 0n;

/** Exact decimal rendering at `scale`; null when the value is off-grid. */
function ratToDecimal(a: Rat, scale: number): string | null {
  const scaled = rMul(a, { n: 10n ** BigInt(scale), d: 1n });
  if (scaled.d !== 1n) return null;
  const neg = scaled.n < 0n;
  const digits = (neg ? -scaled.n : scaled.n).toString().padStart(scale + 1, "0");
  const head = digits.slice(0, digits.length - scale) || "0";
  const tail = scale > 0 ? "." + digits.slice(digits.length - scale) : "";
  return (neg ? "-" : "") + head + tail;
}

const ulpOf = (scale: number): Rat => ({ n: 1n, d: 10n ** BigInt(scale) });

/**
 * Smallest s with denominator | 10^s, or null when the rational is not a
 * decimal (denominator has prime factors other than 2 and 5). Needed
 * because normalization hides powers of ten: 0.0025 is stored as 1/400.
 */
function pow10Scale(d: bigint): number | null {
  let twos = 0;
  let fives = 0;
  let rest = d;
  while (rest % 2n === 0n) {
    rest /= 2n;
    twos++;
  }
  while (rest % 5n === 0n) {
    rest /= 5n;
    fives++;
  }
  return rest === 1n ? Math.max(twos, fives) : null;
}

// ---------------------------------------------------------------------------
// Affine values: c0 + Σ ci·xi with an absolute drift bound (fuzz).
// ---------------------------------------------------------------------------

interface Affine {
  terms: Map<number, Rat>; // input index -> coefficient (never zero)
  c: Rat;
  /** Exact bound on |actual - affine form| introduced by rounding stores. */
  fuzz: Rat;
}

type SymVal =
  | { kind: "affine"; a: Affine }
  | { kind: "text"; input: number }
  | { kind: "opaque"; reason: string };

const affineConst = (c: Rat): Affine => ({ terms: new Map(), c, fuzz: R0 });
const affineVar = (idx: number): Affine => ({ terms: new Map([[idx, { n: 1n, d: 1n }]]), c: R0, fuzz: R0 });

function affineCombine(a: Affine, b: Affine, sign: 1 | -1): Affine {
  const terms = new Map(a.terms);
  for (const [i, cb] of b.terms) {
    const merged = sign === 1 ? rAdd(terms.get(i) ?? R0, cb) : rSub(terms.get(i) ?? R0, cb);
    if (rIsZero(merged)) terms.delete(i);
    else terms.set(i, merged);
  }
  return {
    terms,
    c: sign === 1 ? rAdd(a.c, b.c) : rSub(a.c, b.c),
    fuzz: rAdd(a.fuzz, b.fuzz),
  };
}

function affineScale(a: Affine, k: Rat): Affine {
  const terms = new Map<number, Rat>();
  for (const [i, c] of a.terms) {
    const s = rMul(c, k);
    if (!rIsZero(s)) terms.set(i, s);
  }
  return { terms, c: rMul(a.c, k), fuzz: rMul(a.fuzz, rAbs(k)) };
}

const isConstant = (a: Affine): boolean => a.terms.size === 0 && rIsZero(a.fuzz);

// ---------------------------------------------------------------------------
// Expression parsing over the symbolic environment.
// ---------------------------------------------------------------------------

interface ExprCtx {
  env: Map<string, SymVal>;
  items: DataItem[];
  assigned: Set<string>;
  inputSpec: (textInput: number) => number; // stdin position -> variable index (identity)
}

/** A data item is a usable constant when it has a numeric VALUE and is never assigned. */
function constantRat(item: DataItem, assigned: Set<string>): Rat | null {
  if (!item.value || assigned.has(item.name)) return null;
  if (/^zero(s|es)?$/i.test(item.value)) return R0;
  return ratOf(item.value);
}

function parseExpression(text: string, ctx: ExprCtx): SymVal {
  const raw = text.match(/[A-Z][A-Z0-9-]*\([^)]*\)|[A-Z][A-Z0-9-]*|\d+\.\d+|\.\d+|\d+|[()+\-*/]/g) ?? [];
  let pos = 0;
  const peek = () => raw[pos];
  const opaque = (reason: string): SymVal => ({ kind: "opaque", reason });

  function atom(): SymVal {
    const t = raw[pos];
    if (t === undefined) return opaque("unexpected end of expression");
    if (t === "(") {
      pos++;
      const inner = expr();
      if (peek() !== ")") return opaque("unbalanced parentheses");
      pos++;
      return inner;
    }
    pos++;
    if (/^\d|^\./.test(t)) {
      const r = ratOf(t.startsWith(".") ? "0" + t : t);
      return r ? { kind: "affine", a: affineConst(r) } : opaque(`unparseable literal ${t}`);
    }
    // FUNCTION NUMVAL(WS-X): the tokenizer may keep NUMVAL(arg) glued.
    if (t === "FUNCTION") {
      const f = raw[pos];
      const m = f ? /^NUMVAL\(([A-Z][A-Z0-9-]*)\)$/.exec(f) : null;
      if (!m) return opaque(`unsupported intrinsic after FUNCTION: ${f ?? "?"}`);
      pos++;
      const src = ctx.env.get(m[1]!);
      if (src?.kind === "text") return { kind: "affine", a: affineVar(ctx.inputSpec(src.input)) };
      return opaque(`NUMVAL of ${m[1]} which is not a tracked input`);
    }
    const v = ctx.env.get(t);
    if (v) return v;
    const item = findItem(ctx.items, t);
    const konst = item ? constantRat(item, ctx.assigned) : null;
    if (konst) return { kind: "affine", a: affineConst(konst) };
    return opaque(`identifier ${t} has no symbolic value`);
  }

  function factor(): SymVal {
    let left = atom();
    while (peek() === "*" || peek() === "/") {
      const op = raw[pos++]!;
      const right = atom();
      if (left.kind !== "affine" || right.kind !== "affine") {
        return left.kind === "opaque" ? left : right.kind === "opaque" ? right : { kind: "opaque", reason: "non-affine operand" };
      }
      if (op === "*") {
        if (isConstant(right.a)) left = { kind: "affine", a: affineScale(left.a, right.a.c) };
        else if (isConstant(left.a)) left = { kind: "affine", a: affineScale(right.a, left.a.c) };
        else return { kind: "opaque", reason: "variable × variable product (nonlinear)" };
      } else {
        if (!isConstant(right.a) || rIsZero(right.a.c)) {
          return { kind: "opaque", reason: "division by a non-constant (nonlinear)" };
        }
        left = { kind: "affine", a: affineScale(left.a, rDiv({ n: 1n, d: 1n }, right.a.c)) };
      }
    }
    return left;
  }

  function expr(): SymVal {
    let left = peek() === "-" ? (pos++, negate(factor())) : factor();
    while (peek() === "+" || peek() === "-") {
      const op = raw[pos++]!;
      const right = factor();
      if (left.kind !== "affine" || right.kind !== "affine") {
        return left.kind === "opaque" ? left : right.kind === "opaque" ? right : { kind: "opaque", reason: "non-affine operand" };
      }
      left = { kind: "affine", a: affineCombine(left.a, right.a, op === "+" ? 1 : -1) };
    }
    return left;
  }

  const negate = (v: SymVal): SymVal =>
    v.kind === "affine" ? { kind: "affine", a: affineScale(v.a, { n: -1n, d: 1n }) } : v;

  const out = expr();
  if (pos !== raw.length && out.kind === "affine") {
    return opaque(`trailing tokens in expression: ${raw.slice(pos).join(" ")}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Symbolic execution.
// ---------------------------------------------------------------------------

type CmpOp = ">" | "<" | ">=" | "<=" | "=" | "<>";

interface Constraint {
  /** (diff op 0) must equal `taken`; diff carries its own fuzz. */
  diff: Affine;
  op: CmpOp;
  taken: boolean;
  text: string;
  /** true for PICTURE-capacity bounds injected by stores (not branch conds). */
  domain?: boolean;
}

interface CondOutcome {
  text: string;
  taken: boolean;
  diff: Affine | null; // null = opaque condition
}

interface SymCompute {
  stmt: ComputeStmt;
  /** Expression value at the execution point, before the store. */
  exprVal: SymVal;
}

interface PathState {
  env: Map<string, SymVal>;
  constraints: Constraint[];
  conds: CondOutcome[];
  computes: SymCompute[];
  notes: string[];
}

/** Inline PERFORMed paragraphs so paths are enumerated over one statement tree. */
export function inlineStatements(stmts: Statement[], paras: Map<string, Paragraph>, stack: string[]): Statement[] {
  const out: Statement[] = [];
  for (const s of stmts) {
    if (s.kind === "perform") {
      if (stack.includes(s.target)) {
        throw new DiffExecError(`layer C: PERFORM cycle through ${s.target}; loops need fixpoint machinery`);
      }
      const p = paras.get(s.target);
      if (p) out.push(...inlineStatements(p.statements, paras, [...stack, s.target]));
    } else if (s.kind === "if") {
      out.push({
        ...s,
        then: inlineStatements(s.then, paras, stack),
        ...(s.else ? { else: inlineStatements(s.else, paras, stack) } : {}),
      });
    } else {
      out.push(s);
    }
  }
  return out;
}

interface ExecCtx {
  items: DataItem[];
  assigned: Set<string>;
  acceptOrder: string[]; // ACCEPT targets in source order = stdin positions
}

function cloneState(s: PathState): PathState {
  return {
    env: new Map(s.env),
    constraints: [...s.constraints],
    conds: [...s.conds],
    computes: [...s.computes],
    notes: [...s.notes],
  };
}

/** Store `val` into `target`, modeling scale truncation/rounding as fuzz. */
function store(state: PathState, ctx: ExecCtx, target: string, val: SymVal, rounded: boolean): void {
  if (val.kind !== "affine") {
    state.env.set(target, val);
    return;
  }
  const item = findItem(ctx.items, target);
  const scale = item?.type?.scale ?? 0;
  const digits = item?.type?.digits;
  const grid = 10n ** BigInt(scale);
  // Exact when every coefficient and the constant land on the target grid
  // (then no rounding happens for on-grid inputs).
  const exact =
    rIsZero(val.a.fuzz) &&
    rMul(val.a.c, { n: grid, d: 1n }).d === 1n &&
    [...val.a.terms.values()].every((c) => rMul(c, { n: grid, d: 1n }).d === 1n);
  let fuzz = val.a.fuzz;
  if (!exact) {
    const u = ulpOf(scale);
    fuzz = rAdd(fuzz, rounded ? rDiv(u, { n: 2n, d: 1n }) : u);
  }
  const storedVal: Affine = { terms: val.a.terms, c: val.a.c, fuzz };
  state.env.set(target, { kind: "affine", a: storedVal });
  // Capacity: constrain the path to the wrap-free region — solutions the
  // solver produces stay in the linear regime; wrap semantics belong to
  // layers A/B, which sample it.
  if (digits !== undefined && item?.type?.category === "numeric") {
    const max = rat(10n ** BigInt(digits) - 1n, grid);
    state.constraints.push({ diff: storedVal, op: ">=", taken: true, text: `${target} >= 0 (storage)`, domain: true });
    state.constraints.push({
      diff: affineCombine(storedVal, affineConst(max), -1),
      op: "<=",
      taken: true,
      text: `${target} <= ${ratToDecimal(max, scale)} (storage)`,
      domain: true,
    });
  }
}

function parseCondition(text: string, ctx: ExprCtx): { diff: Affine; op: CmpOp } | null {
  const m = /^(.*?)\s*(>=|<=|<>|>|<|=)\s*(.*)$/.exec(text.trim());
  if (!m) return null;
  const left = parseExpression(m[1]!, ctx);
  const right = parseExpression(m[3]!, ctx);
  if (left.kind !== "affine" || right.kind !== "affine") return null;
  return { diff: affineCombine(left.a, right.a, -1), op: m[2] as CmpOp };
}

function execute(stmts: Statement[], state: PathState, ctx: ExecCtx, out: PathState[]): void {
  const exprCtx = (): ExprCtx => ({
    env: state.env,
    items: ctx.items,
    assigned: ctx.assigned,
    inputSpec: (i) => i,
  });
  for (let si = 0; si < stmts.length; si++) {
    const s = stmts[si]!;
    switch (s.kind) {
      case "accept": {
        const pos = ctx.acceptOrder.indexOf(s.target);
        const item = findItem(ctx.items, s.target);
        if (item?.type?.category === "numeric") {
          state.env.set(s.target, { kind: "affine", a: affineVar(pos) });
        } else {
          state.env.set(s.target, { kind: "text", input: pos });
        }
        break;
      }
      case "move": {
        const v = parseExpression(s.from.text, exprCtx());
        for (const t of s.to) store(state, ctx, t, v, false);
        break;
      }
      case "compute": {
        const v = parseExpression(s.expression.text, exprCtx());
        state.computes.push({ stmt: s, exprVal: v });
        store(state, ctx, s.target, v, s.rounded);
        break;
      }
      case "if": {
        const parsed = parseCondition(s.condition.text, exprCtx());
        const rest = stmts.slice(si + 1);
        for (const [branch, taken] of [
          [s.then, true],
          [s.else ?? [], false],
        ] as const) {
          const forked = cloneState(state);
          forked.conds.push({ text: s.condition.text, taken, diff: parsed?.diff ?? null });
          if (parsed) {
            forked.constraints.push({ diff: parsed.diff, op: parsed.op, taken, text: s.condition.text });
          } else {
            forked.notes.push(`condition "${s.condition.text}" is not affine; path constraints incomplete`);
          }
          execute([...branch, ...rest], forked, ctx, out);
          if (out.length > MAX_PATHS) {
            throw new DiffExecError(`layer C: more than ${MAX_PATHS} paths; needs bounded exploration`);
          }
        }
        return; // both forks continued with the rest of the statements
      }
      case "display":
      case "exit":
      case "stop-run":
      case "goback":
        break; // flow-neutral for the symbolic store
      case "perform":
        break; // already inlined; unresolved targets have no body to run
      default: {
        const never: never = s;
        throw new DiffExecError(`layer C: unsupported statement kind ${(never as Statement).kind}`);
      }
    }
  }
  out.push(state);
}

// ---------------------------------------------------------------------------
// Constraint checking and solving.
// ---------------------------------------------------------------------------

interface InputVar {
  idx: number;
  name: string;
  scale: number;
  max: Rat;
  numeric: boolean;
}

type Assignment = (Rat | null)[]; // by stdin position; null = alphanumeric

function evalAffine(a: Affine, x: Assignment): Rat {
  let acc = a.c;
  for (const [i, c] of a.terms) {
    const v = x[i];
    if (v === null || v === undefined) throw new DiffExecError(`layer C: no value for input #${i}`);
    acc = rAdd(acc, rMul(c, v));
  }
  return acc;
}

/** true / false / "margin" (inside the fuzz band — cannot be trusted). */
function constraintHolds(c: Constraint, x: Assignment): boolean | "margin" {
  const v = evalAffine(c.diff, x);
  const f = c.diff.fuzz;
  const cmp = (r: number): boolean => {
    switch (c.op) {
      case ">": return r > 0;
      case "<": return r < 0;
      case ">=": return r >= 0;
      case "<=": return r <= 0;
      case "=": return r === 0;
      case "<>": return r !== 0;
    }
  };
  if (rIsZero(f)) return cmp(rCmp(v, R0)) === c.taken;
  // With fuzz, the decision is only trustworthy outside the band |v| <= f.
  if (rCmp(rAbs(v), f) <= 0) return "margin";
  return cmp(rCmp(v, R0)) === c.taken;
}

function allConstraintsHold(constraints: Constraint[], x: Assignment): boolean | "margin" {
  let sawMargin = false;
  for (const c of constraints) {
    const h = constraintHolds(c, x);
    if (h === false) return false;
    if (h === "margin") sawMargin = true;
  }
  return sawMargin ? "margin" : true;
}

/** Solve diff(x) = target over one free variable, others fixed. */
function solveEquality(
  diff: Affine,
  target: Rat,
  inputs: InputVar[],
  fixedCandidates: Assignment[],
  constraints: Constraint[],
): Assignment | null {
  for (const base of fixedCandidates) {
    for (const [j, cj] of diff.terms) {
      const spec = inputs[j];
      if (!spec?.numeric || rIsZero(cj)) continue;
      // rest = c0 + Σ_{i≠j} ci·xi
      let rest = diff.c;
      let usable = true;
      for (const [i, ci] of diff.terms) {
        if (i === j) continue;
        const v = base[i];
        if (v === null || v === undefined) {
          usable = false;
          break;
        }
        rest = rAdd(rest, rMul(ci, v));
      }
      if (!usable) continue;
      const xj = rDiv(rSub(target, rest), cj);
      if (ratToDecimal(xj, spec.scale) === null) continue; // off the PICTURE grid
      if (rCmp(xj, R0) < 0 || rCmp(xj, spec.max) > 0) continue;
      const x: Assignment = [...base];
      x[j] = xj;
      if (allConstraintsHold(constraints, x) === true) return x;
    }
  }
  return null;
}

/**
 * Solve k·x ≡ h (mod m) over BigInt (all ≥ 0, m > 0), smallest positive
 * solutions first, subject to x ≤ maxX.
 */
function egcd(a: bigint, b: bigint): [bigint, bigint, bigint] {
  if (b === 0n) return [a, 1n, 0n];
  const [g, x, y] = egcd(b, a % b);
  return [g, y, x - (a / b) * y];
}

function solveCongruence(k: bigint, h: bigint, m: bigint, maxSolutions: number, maxX: bigint): bigint[] {
  const kk = ((k % m) + m) % m;
  const hh = ((h % m) + m) % m;
  const [g] = egcd(kk === 0n ? m : kk, m);
  if (hh % g !== 0n) return [];
  const m2 = m / g;
  const k2 = (kk / g) % m2;
  const h2 = (hh / g) % m2;
  const [, inv] = egcd(k2 === 0n ? m2 : k2, m2);
  const x0 = m2 === 0n ? 0n : ((h2 * (((inv % m2) + m2) % m2)) % m2 + m2) % m2;
  const out: bigint[] = [];
  for (let t = 0n; out.length < maxSolutions; t++) {
    const sol = x0 + t * m2;
    if (sol > maxX) break;
    if (sol > 0n) out.push(sol);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

type ObligationStatus = "VERIFIED" | "DIVERGENT" | "UNREALIZED" | "NOT-APPLICABLE";

interface ObligationCase {
  id: string;
  stdin: string[];
  note: string;
  result?: CaseResult;
}

interface Obligation {
  id: string;
  kind: "branch-boundary" | "rounding-half-boundary";
  description: string;
  status: ObligationStatus;
  cases: ObligationCase[];
  notes: string[];
  unrealizedPaths: { path: number; reason: string }[];
}

export function runSymExec(configPath: string, outPath: string): number {
  const config = loadConfig(configPath);
  const baseDir = dirname(resolve(configPath));
  const sym = config.symbolic;
  if (!sym) throw new DiffExecError('layer C needs a "symbolic" block in the config (ir, stdinFields, baseCase)');
  if (!Array.isArray(sym.baseCase) || sym.baseCase.length !== sym.stdinFields.length) {
    throw new DiffExecError('layer C: "symbolic.baseCase" must have one value per entry in "stdinFields"');
  }

  const irPath = resolve(baseDir, sym.ir);
  const ir = JSON.parse(readFileSync(irPath, "utf8")) as ModuleIR;
  const items = ir.dataDivision.items;
  const moneyRe = new RegExp(sym.moneyPattern ?? DEFAULT_MONEY_PATTERN);
  const annotations = new Set(sym.annotations ?? []);
  const maxSolutions = sym.maxBoundarySolutions ?? 5;

  const inputItems = sym.stdinFields.map((n) => {
    const item = findItem(items, n);
    if (!item) throw new DiffExecError(`layer C: field ${n} not found in the data division of ${sym.ir}`);
    return item;
  });
  const inputs: InputVar[] = inputItems.map((item, idx) => ({
    idx,
    name: item.name,
    scale: item.type?.scale ?? 0,
    max:
      item.type?.digits !== undefined
        ? rat(10n ** BigInt(item.type.digits) - 1n, 10n ** BigInt(item.type?.scale ?? 0))
        : R0,
    numeric: item.type?.category === "numeric",
  }));

  const assigned = new Set<string>();
  const collectAssigned = (stmts: Statement[]): void => {
    for (const s of stmts) {
      if (s.kind === "move") for (const t of s.to) assigned.add(t);
      else if (s.kind === "compute") assigned.add(s.target);
      else if (s.kind === "accept") assigned.add(s.target);
      else if (s.kind === "if") {
        collectAssigned(s.then);
        collectAssigned(s.else ?? []);
      }
    }
  };
  for (const p of ir.procedureDivision.paragraphs) collectAssigned(p.statements);

  // --- 1. symbolic execution over every path ---------------------------------
  const paras = new Map(ir.procedureDivision.paragraphs.map((p) => [p.name, p]));
  const entry = paras.get(ir.controlFlow.entry);
  if (!entry) throw new DiffExecError(`layer C: entry paragraph ${ir.controlFlow.entry} not found`);
  const tree = inlineStatements(entry.statements, paras, [ir.controlFlow.entry]);

  const acceptOrder: string[] = [];
  const collectAccepts = (stmts: Statement[]): void => {
    for (const s of stmts) {
      if (s.kind === "accept") acceptOrder.push(s.target);
      else if (s.kind === "if") {
        collectAccepts(s.then);
        collectAccepts(s.else ?? []);
      }
    }
  };
  collectAccepts(tree);

  const ctx: ExecCtx = { items, assigned, acceptOrder };
  const states: PathState[] = [];
  execute(tree, { env: new Map(), constraints: [], conds: [], computes: [], notes: [] }, ctx, states);
  const paths = states.map((st, i) => ({ id: i, state: st }));

  console.log(`legacymind verify (layer C: path-sensitive symbolic engine)`);
  console.log(`  legacy: ${config.legacy.label ?? config.legacy.argv.join(" ")}`);
  console.log(`  modern: ${config.modern.label ?? config.modern.argv.join(" ")}`);
  console.log(`  paths enumerated: ${paths.length}; money pattern: /${moneyRe.source}/`);
  console.log("");

  // Fixed-value candidates for the solver: the base case, then zeros.
  const baseAssign: Assignment = sym.baseCase.map((v, i) => (inputs[i]!.numeric ? ratOf(v) : null));
  const zeroAssign: Assignment = inputs.map((s) => (s.numeric ? R0 : null));
  const fixedCandidates = [baseAssign, zeroAssign];

  const toStdin = (x: Assignment): string[] =>
    x.map((v, i) => (v === null ? sym.baseCase[i]! : ratToDecimal(v, inputs[i]!.scale) ?? sym.baseCase[i]!));

  // --- 2. branch-boundary obligations -----------------------------------------
  // A condition's decision value is path-dependent (an accumulator may be
  // degenerate on one path and fully affine on another), so each unique
  // condition is solved against every path's own diff.
  const obligations: Obligation[] = [];
  const condSites = new Map<string, Map<number, Affine | null>>();
  for (const path of paths) {
    for (const c of path.state.conds) {
      let site = condSites.get(c.text);
      if (!site) {
        site = new Map();
        condSites.set(c.text, site);
      }
      if (!site.has(path.id)) site.set(path.id, c.diff);
    }
  }
  let branchN = 0;
  for (const [condText, perPath] of condSites) {
    branchN++;
    const ob: Obligation = {
      id: `branch-${branchN}`,
      kind: "branch-boundary",
      description: `IF ${condText}`,
      status: "UNREALIZED",
      cases: [],
      notes: [],
      unrealizedPaths: [],
    };
    obligations.push(ob);
    const usable = [...perPath.entries()].filter(
      ([, d]) => d !== null && rIsZero(d.fuzz) && d.terms.size > 0,
    ) as [number, Affine][];
    if (usable.length === 0) {
      const d = [...perPath.values()].find((x) => x !== null);
      ob.notes.push(
        d === undefined || d === null
          ? "condition is not an affine form on any path; needs nonlinear reasoning"
          : !rIsZero(d.fuzz)
            ? `condition value carries rounding drift (±${ratToDecimal(d.fuzz, 6) ?? "?"}); ` +
              "the boundary cannot be pinned exactly through a rounded store"
            : "condition decision value is constant on every path",
      );
      continue;
    }
    for (const [suffix, mkTarget, label] of [
      ["m", (u: Rat) => rNeg(u), "boundary - 1ulp"],
      ["0", () => R0, "boundary"],
      ["p", (u: Rat) => u, "boundary + 1ulp"],
    ] as const) {
      let solved: Assignment | null = null;
      let solvedPath = -1;
      for (const [pathId, diff] of usable) {
        const scales = [...diff.terms.keys()].map((i) => inputs[i]?.scale ?? 0);
        const ulp = ulpOf(scales.length > 0 ? Math.max(...scales) : 0);
        solved = solveEquality(diff, mkTarget(ulp), inputs, fixedCandidates, paths[pathId]!.state.constraints);
        if (solved) {
          solvedPath = pathId;
          break;
        }
      }
      if (solved) {
        ob.cases.push({
          id: `sym-${ob.id}-${suffix}`,
          stdin: toStdin(solved),
          note: `${condText} decision value at ${label} (path #${solvedPath})`,
        });
      } else {
        ob.notes.push(`no on-grid inputs reach ${label} within any path's constraints`);
      }
    }
  }

  // --- 3. rounding half-boundary obligations -----------------------------------
  // Gather each unique money-touching ROUNDED compute with its per-path
  // expression value — the same statement can be affine on one path and
  // degenerate (constant) on another, so realization is chosen per path.
  interface RoundedSite {
    cmp: ComputeStmt;
    perPath: Map<number, SymVal>;
  }
  const roundedSites = new Map<string, RoundedSite>();
  for (const path of paths) {
    for (const sc of path.state.computes) {
      const cmp = sc.stmt;
      if (!cmp.rounded) continue;
      const money =
        moneyRe.test(cmp.target) ||
        annotations.has(cmp.target) ||
        cmp.expression.refs.some((r) => moneyRe.test(r) || annotations.has(r));
      if (!money) continue;
      let site = roundedSites.get(cmp.text);
      if (!site) {
        site = { cmp, perPath: new Map() };
        roundedSites.set(cmp.text, site);
      }
      if (!site.perPath.has(path.id)) site.perPath.set(path.id, sc.exprVal);
    }
  }

  let roundN = 0;
  for (const site of roundedSites.values()) {
    const cmp = site.cmp;
    roundN++;
    const ob: Obligation = {
      id: `round-${roundN}`,
      kind: "rounding-half-boundary",
      description: cmp.text,
      status: "UNREALIZED",
      cases: [],
      notes: [],
      unrealizedPaths: [],
    };
    obligations.push(ob);

    const targetItem = findItem(items, cmp.target);
    const st = targetItem?.type?.scale ?? 0;
    let anyAffine = false;
    let anyBoundaryExists = false;

    for (const [pathId, exprVal] of site.perPath) {
      const path = paths[pathId]!;
      if (exprVal.kind !== "affine" || !rIsZero(exprVal.a.fuzz) || exprVal.a.terms.size === 0) {
        const reason =
          exprVal.kind === "opaque"
            ? exprVal.reason
            : exprVal.kind === "affine" && exprVal.a.terms.size === 0
              ? "expression is constant on this path (no input can move it)"
              : "expression carries rounding drift on this path";
        ob.unrealizedPaths.push({ path: pathId, reason });
        continue;
      }
      anyAffine = true;
      const a = exprVal.a;
      // L = the scale at which the expression is integral for on-grid
      // inputs; a half-unit at the target scale is then m/2, m = 10^(L-st).
      let scaleL = 0;
      let decimal = true;
      for (const [i, coeff] of a.terms) {
        const si = inputs[i]?.scale ?? 0;
        const s = pow10Scale(rMul(coeff, { n: 1n, d: 10n ** BigInt(si) }).d);
        if (s === null) {
          decimal = false;
          break;
        }
        scaleL = Math.max(scaleL, s);
      }
      const s0 = pow10Scale(a.c.d);
      if (s0 === null) decimal = false;
      else scaleL = Math.max(scaleL, s0);
      if (!decimal) {
        ob.unrealizedPaths.push({ path: pathId, reason: "expression has non-decimal coefficients" });
        continue;
      }
      const modExp = scaleL - st;
      if (modExp <= 0) {
        ob.unrealizedPaths.push({ path: pathId, reason: "expression is exact at the target scale on this path" });
        continue;
      }
      anyBoundaryExists = true;
      const m = 10n ** BigInt(modExp);
      const h = m / 2n;
      const scaleMul = 10n ** BigInt(scaleL);
      let realizedOnPath = false;
      for (const fixed of fixedCandidates) {
        if (realizedOnPath) break;
        for (const [j, cj] of a.terms) {
          if (realizedOnPath) break;
          const spec = inputs[j];
          if (!spec?.numeric) continue;
          let rest = a.c;
          let usable = true;
          for (const [i, ci] of a.terms) {
            if (i === j) continue;
            const v = fixed[i];
            if (v === null || v === undefined) {
              usable = false;
              break;
            }
            rest = rAdd(rest, rMul(ci, v));
          }
          if (!usable) continue;
          const kScaled = rMul(cj, { n: scaleMul, d: 10n ** BigInt(spec.scale) });
          const restScaled = rMul(rest, { n: scaleMul, d: 1n });
          if (kScaled.d !== 1n || restScaled.d !== 1n) continue;
          const maxXInt = rMul(spec.max, { n: 10n ** BigInt(spec.scale), d: 1n });
          const sols = solveCongruence(
            kScaled.n,
            ((h - (restScaled.n % m)) % m + m) % m,
            m,
            maxSolutions,
            maxXInt.d === 1n ? maxXInt.n : 0n,
          );
          for (const sol of sols) {
            const x: Assignment = [...fixed];
            x[j] = rat(sol, 10n ** BigInt(spec.scale));
            if (allConstraintsHold(path.state.constraints, x) !== true) continue;
            ob.cases.push({
              id: `sym-${ob.id}-p${pathId}-${ob.cases.length}`,
              stdin: toStdin(x),
              note: `${spec.name} = ${ratToDecimal(x[j]!, spec.scale)} lands ${cmp.target} on a half-${st === 0 ? "unit" : "cent"} (path #${pathId})`,
            });
            realizedOnPath = true;
            if (ob.cases.length >= maxSolutions * 2) break;
          }
        }
      }
      if (!realizedOnPath) {
        ob.unrealizedPaths.push({
          path: pathId,
          reason: "the half-boundary congruence has no on-grid solution within this path's constraints",
        });
      }
    }

    if (ob.cases.length > 0) {
      ob.notes.push(`affine congruence solved: expression ≡ half-unit (mod target grid) at target scale ${st}`);
    } else if (anyAffine && !anyBoundaryExists && ob.unrealizedPaths.every((u) => u.reason.includes("exact at the target scale"))) {
      ob.status = "NOT-APPLICABLE";
      ob.notes.push("the expression is exact at the target scale on every path; no rounding boundary exists");
    } else if (!anyAffine) {
      // v1 fallback: source * constant with an invertible producer.
      ob.notes.push("affine engine: expression not affine on any path; falling back to producer-inversion heuristic");
      ob.unrealizedPaths = [];
      legacyRoundingRealization(ob, cmp, paths, inputs, sym.baseCase, items, assigned, maxSolutions, st);
    }
  }

  // --- 4. path witnesses ---------------------------------------------------------
  interface Witness {
    path: number;
    stdin: string[] | null;
    note: string;
    result?: CaseResult;
  }
  const witnesses: Witness[] = paths.map((p) => {
    if (p.state.conds.some((c) => !c.diff)) {
      return { path: p.id, stdin: null, note: "path has a non-affine condition; witness selection is not sound" };
    }
    // Try the fixed candidates first, then repair one violated constraint at
    // a time by solving its boundary with margin.
    const tried: Assignment[] = [...fixedCandidates];
    for (let round = 0; round < 6; round++) {
      const x = tried.shift();
      if (!x) break;
      if (x.some((v, i) => inputs[i]!.numeric && v === null)) continue;
      const ok = allConstraintsHold(p.state.constraints, x);
      if (ok === true) {
        return { path: p.id, stdin: toStdin(x), note: `witness for path #${p.id}` };
      }
      // Find the first violated/marginal branch constraint and push the
      // decision value beyond its boundary (fuzz + 1ulp margin).
      for (const c of p.state.constraints) {
        if (constraintHolds(c, x) === true) continue;
        const scales = [...c.diff.terms.keys()].map((i) => inputs[i]?.scale ?? 0);
        const ulp = ulpOf(scales.length > 0 ? Math.max(...scales) : 0);
        const margin = rAdd(c.diff.fuzz, ulp);
        // Desired sign of diff so that (diff op 0) === taken holds strictly:
        //   >,>=: taken wants +, not-taken wants -;  <,<=: mirrored;
        //   =: taken wants exactly 0, not-taken wants any nonzero (+);
        //   <>: taken wants nonzero (+), not-taken wants exactly 0.
        let target: Rat;
        if ((c.op === "=" && c.taken) || (c.op === "<>" && !c.taken)) {
          target = R0;
        } else if (c.op === ">" || c.op === ">=") {
          target = c.taken ? margin : rNeg(margin);
        } else if (c.op === "<" || c.op === "<=") {
          target = c.taken ? rNeg(margin) : margin;
        } else {
          target = margin; // "=" not-taken / "<>" taken
        }
        const solved = solveEquality(c.diff, target, inputs, [x], p.state.constraints);
        if (solved) tried.push(solved);
        break;
      }
    }
    return { path: p.id, stdin: null, note: "no assignment satisfied all path constraints (see constraints in report)" };
  });

  // --- 5. execute all realized cases ---------------------------------------------
  let executed = 0;
  for (const ob of obligations) {
    for (const oc of ob.cases) {
      oc.result = runCase(config, baseDir, { id: oc.id, stdin: oc.stdin });
      executed++;
      console.log(`  ${oc.result.status.padEnd(5)} ${oc.id} ${oc.note}`);
      if (oc.result.status !== "PASS") {
        for (const d of oc.result.diffs) console.log(`        ${d.field}: legacy=${d.legacy} modern=${d.modern}`);
        for (const n of oc.result.notes) console.log(`        note: ${n}`);
      }
    }
    if (ob.status !== "NOT-APPLICABLE") {
      if (ob.cases.length === 0) ob.status = "UNREALIZED";
      else if (ob.cases.some((c) => c.result!.status !== "PASS")) ob.status = "DIVERGENT";
      else ob.status = "VERIFIED";
    }
    if (ob.unrealizedPaths.length > 0 && ob.status === "VERIFIED") {
      ob.notes.push(
        `verified on ${ob.cases.length} case(s), but ${ob.unrealizedPaths.length} path(s) could not be realized — see unrealizedPaths`,
      );
    }
  }
  for (const w of witnesses) {
    if (!w.stdin) continue;
    w.result = runCase(config, baseDir, { id: `sym-witness-p${w.path}`, stdin: w.stdin });
    executed++;
    console.log(`  ${w.result.status.padEnd(5)} sym-witness-p${w.path} ${w.note}`);
    if (w.result.status !== "PASS") {
      for (const d of w.result.diffs) console.log(`        ${d.field}: legacy=${d.legacy} modern=${d.modern}`);
    }
  }

  // --- 6. path coverage ------------------------------------------------------------
  const allObCases = obligations.flatMap((o) => o.cases);
  const pathCoverage = paths.map((p) => {
    const conds = p.state.conds.map((c) => `${c.text} = ${c.taken}`);
    if (p.state.conds.some((c) => !c.diff)) {
      return { id: p.id, conds, covered: "unknown" as const };
    }
    const accepts = (stdin: string[]): boolean => {
      const x: Assignment = stdin.map((v, i) => (inputs[i]!.numeric ? ratOf(v) : null));
      return allConstraintsHold(p.state.constraints, x) === true;
    };
    const covered =
      allObCases.some((oc) => oc.result?.status === "PASS" && accepts(oc.stdin)) ||
      witnesses.some((w) => w.path === p.id && w.result?.status === "PASS");
    return { id: p.id, conds, covered };
  });

  // --- report -----------------------------------------------------------------------
  const counts = {
    total: obligations.length,
    verified: obligations.filter((o) => o.status === "VERIFIED").length,
    divergent: obligations.filter((o) => o.status === "DIVERGENT").length,
    unrealized: obligations.filter((o) => o.status === "UNREALIZED").length,
    notApplicable: obligations.filter((o) => o.status === "NOT-APPLICABLE").length,
  };
  const witnessResults = witnesses.filter((w) => w.result);
  const caseCounts = {
    total: executed,
    passed:
      allObCases.filter((c) => c.result?.status === "PASS").length +
      witnessResults.filter((w) => w.result!.status === "PASS").length,
    failed:
      allObCases.filter((c) => c.result?.status === "FAIL").length +
      witnessResults.filter((w) => w.result!.status === "FAIL").length,
    errored:
      allObCases.filter((c) => c.result?.status === "ERROR").length +
      witnessResults.filter((w) => w.result!.status === "ERROR").length,
  };
  const verdict: "PASS" | "FAIL" =
    counts.divergent === 0 && caseCounts.errored === 0 && caseCounts.failed === 0 ? "PASS" : "FAIL";
  const unrealizedPathTotal = obligations.reduce((n, o) => n + o.unrealizedPaths.length, 0);

  const report = {
    tool: "legacymind symexec (verifier layer C)",
    version: "0.2.0",
    generatedAt: new Date().toISOString(),
    verdict,
    summary: {
      obligations: counts,
      cases: caseCounts,
      paths: {
        total: paths.length,
        covered: pathCoverage.filter((p) => p.covered === true).length,
        unknown: pathCoverage.filter((p) => p.covered === "unknown").length,
      },
      unrealizedPathObligations: unrealizedPathTotal,
      witnesses: {
        realized: witnesses.filter((w) => w.stdin !== null).length,
        total: witnesses.length,
      },
    },
    symbolic: {
      ir: sym.ir,
      irSha256: createHash("sha256").update(readFileSync(irPath)).digest("hex"),
      stdinFields: sym.stdinFields,
      baseCase: sym.baseCase,
      moneyPattern: moneyRe.source,
      note:
        "path-sensitive engine: exact-rational affine execution with fuzz-bounded rounding stores, " +
        "equality/congruence solving on PICTURE grids, per-path witnesses; nonlinear forms fall back " +
        "to producer-inversion and are disclosed",
    },
    paths: pathCoverage.map((p, i) => ({
      ...p,
      witness: witnesses[i]!.stdin
        ? { stdin: witnesses[i]!.stdin, status: witnesses[i]!.result?.status }
        : { unrealized: witnesses[i]!.note },
    })),
    obligations: obligations.map((o) => ({
      ...o,
      cases: o.cases.map((c) => ({
        id: c.id,
        stdin: c.stdin,
        note: c.note,
        status: c.result?.status,
        diffs: c.result?.diffs,
        raw: c.result?.status !== "PASS" ? c.result?.raw : undefined,
      })),
    })),
    config: {
      path: resolve(configPath).replace(/\\/g, "/"),
      sha256: createHash("sha256").update(readFileSync(configPath)).digest("hex"),
      numericTolerance: config.numericTolerance ?? 0,
    },
    artifacts: {
      legacy: { label: config.legacy.label ?? null, argv: config.legacy.argv, sha256: artifactHash(config.legacy, baseDir) },
      modern: { label: config.modern.label ?? null, argv: config.modern.argv, sha256: artifactHash(config.modern, baseDir) },
    },
  };

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log("");
  for (const ob of obligations) {
    console.log(`  ${ob.status.padEnd(14)} ${ob.id}: ${ob.description}`);
    for (const n of ob.notes) console.log(`        ${n}`);
    for (const up of ob.unrealizedPaths) console.log(`        UNREALIZED on path #${up.path}: ${up.reason}`);
  }
  console.log("");
  console.log(
    `  verdict: ${verdict}  (obligations: ${counts.verified} verified, ${counts.divergent} divergent, ` +
      `${counts.unrealized} unrealized, ${counts.notApplicable} n/a; ` +
      `paths covered: ${report.summary.paths.covered}/${paths.length}; ` +
      `witnesses: ${report.summary.witnesses.realized}/${witnesses.length})`,
  );
  console.log(`  report: ${outPath}`);
  return verdict === "PASS" ? 0 : 1;
}

// ---------------------------------------------------------------------------
// v1 fallback: `source * constant` rounding realization via producer inversion.
// Kept verbatim in spirit so nonlinear modules (e.g. hours × rate products)
// retain their coverage; everything it cannot do is disclosed.
// ---------------------------------------------------------------------------

const bare = (tok: string): string => tok.replace(/^\(+/, "").replace(/\)+$/, "");

function legacyRoundingRealization(
  ob: Obligation,
  cmp: ComputeStmt,
  paths: { id: number; state: PathState }[],
  inputs: InputVar[],
  baseCase: string[],
  items: DataItem[],
  assigned: Set<string>,
  maxSolutions: number,
  targetScale: number,
): void {
  const inputIdx = new Map(inputs.map((s) => [s.name, s.idx]));
  const toks = cmp.expression.text.split(/\s+/).map(bare);
  if (toks.length !== 3 || toks[1] !== "*") {
    ob.notes.push("fallback: expression is not a simple `source * constant` product");
    return;
  }
  const [aName, , bName] = toks as [string, string, string];
  const aItem = findItem(items, aName);
  const bItem = findItem(items, bName);
  const aConst = aItem ? constantRat(aItem, assigned) : null;
  const bConst = bItem ? constantRat(bItem, assigned) : null;
  const konst = aConst ?? bConst;
  const srcItem = aConst ? bItem : aItem;
  if (!konst || !srcItem || (aConst && bConst)) {
    ob.notes.push("fallback: could not statically identify exactly one constant factor");
    return;
  }
  const sx = srcItem.type?.scale ?? 0;
  const sk = pow10Scale(konst.d);
  if (sk === null) {
    ob.notes.push("fallback: the constant factor is not a decimal");
    return;
  }
  // Integer view: konst = kInt / 10^sk with kInt = konst.n · (10^sk / konst.d).
  const kInt = konst.n * (10n ** BigInt(sk) / konst.d);
  const modExp = sx + sk - targetScale;
  if (modExp <= 0) {
    ob.status = "NOT-APPLICABLE";
    ob.notes.push("fallback: product is exact at the target scale");
    return;
  }
  const m = 10n ** BigInt(modExp);
  const srcMax = srcItem.type?.digits !== undefined ? 10n ** BigInt(srcItem.type.digits) - 1n : 0n;
  const solutions = solveCongruence(kInt, m / 2n, m, maxSolutions, srcMax);
  if (solutions.length === 0) {
    ob.status = "NOT-APPLICABLE";
    ob.notes.push("fallback: the half-boundary congruence has no solution in the source domain");
    return;
  }
  const fmtScaled = (v: bigint): string => ratToDecimal(rat(v, 10n ** BigInt(sx)), sx) ?? "?";
  ob.notes.push(`fallback congruence: source ${srcItem.name} boundary values ` + solutions.map(fmtScaled).join(", "));

  // A candidate stdin belongs on a path only when its (affine) constraints
  // accept it; paths with non-affine conditions accept with a disclosure.
  const onPath = (path: { state: PathState }, stdin: string[]): boolean => {
    if (path.state.conds.some((c) => !c.diff)) return true; // undecidable: run anyway, disclosed by coverage
    const x: Assignment = stdin.map((v, i) => (inputs[i]!.numeric ? ratOf(v) : null));
    return allConstraintsHold(path.state.constraints, x) === true;
  };

  for (const path of paths) {
    let realizedOnPath = false;
    const directIdx = inputIdx.get(srcItem.name);
    if (directIdx !== undefined) {
      for (const [i, sol] of solutions.entries()) {
        const stdin = [...baseCase];
        stdin[directIdx] = fmtScaled(sol);
        if (!onPath(path, stdin)) continue;
        ob.cases.push({ id: `sym-${ob.id}-p${path.id}-${i}`, stdin, note: `${srcItem.name} = ${fmtScaled(sol)} directly (path #${path.id})` });
        realizedOnPath = true;
      }
    } else {
      const producer = path.state.computes.find((c2) => {
        if (c2.stmt.target !== srcItem.name) return false;
        const t2 = c2.stmt.expression.text.split(/\s+/).map(bare);
        return t2.length === 3 && t2[1] === "*" && inputIdx.has(t2[0]!) && inputIdx.has(t2[2]!);
      });
      if (producer) {
        const t2 = producer.stmt.expression.text.split(/\s+/).map(bare);
        for (const [xName, yName] of [[t2[0]!, t2[2]!], [t2[2]!, t2[0]!]] as const) {
          if (realizedOnPath) break;
          const xIdx = inputIdx.get(xName)!;
          const yIdx = inputIdx.get(yName)!;
          const xSpec = inputs[xIdx]!;
          if (xSpec.scale !== sx) continue;
          for (const [i, sol] of solutions.entries()) {
            const xVal = rat(sol, 10n ** BigInt(sx));
            if (rCmp(xVal, xSpec.max) > 0) continue;
            const stdin = [...baseCase];
            stdin[xIdx] = fmtScaled(sol);
            stdin[yIdx] = ratToDecimal({ n: 1n, d: 1n }, inputs[yIdx]!.scale) ?? "1";
            if (!onPath(path, stdin)) continue;
            ob.cases.push({
              id: `sym-${ob.id}-p${path.id}-${i}`,
              stdin,
              note: `${srcItem.name} = ${fmtScaled(sol)} via ${producer.stmt.text} with ${yName} = 1 (path #${path.id})`,
            });
            realizedOnPath = true;
          }
        }
      }
    }
    if (!realizedOnPath) {
      ob.unrealizedPaths.push({
        path: path.id,
        reason: `fallback: no invertible producer of ${srcItem.name} from input fields on this path`,
      });
    }
  }
}
