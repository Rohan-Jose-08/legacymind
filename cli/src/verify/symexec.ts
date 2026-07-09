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
  sideLabel,
  sideRef,
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

/**
 * Exact structure of a value whose fuzzy affine form went through rounding:
 * an affine part plus a linear combination of rounded terms, each
 * round_mode,scale(inner) with an exactly-affine inner. One level deep —
 * a rounded value flowing into another rounding drops the exact form (the
 * fuzz bound still applies).
 */
interface RoundTerm {
  coeff: Rat;
  mode: "half-up" | "trunc";
  scale: number;
  inner: Affine; // fuzz always 0 by construction
}

interface ExactForm {
  affine: Affine; // fuzz always 0 by construction
  rounds: RoundTerm[];
}

type SymVal =
  | { kind: "affine"; a: Affine; exact?: ExactForm }
  | { kind: "text"; input: number }
  | { kind: "opaque"; reason: string };

/** Exact form of a value: explicit, or the affine itself when drift-free. */
function exactOf(v: SymVal): ExactForm | null {
  if (v.kind !== "affine") return null;
  if (v.exact) return v.exact;
  return rIsZero(v.a.fuzz) ? { affine: v.a, rounds: [] } : null;
}

function exactCombine(a: ExactForm, b: ExactForm, sign: 1 | -1): ExactForm {
  return {
    affine: affineCombine(a.affine, b.affine, sign),
    rounds: [
      ...a.rounds,
      ...b.rounds.map((r) => (sign === 1 ? r : { ...r, coeff: rNeg(r.coeff) })),
    ],
  };
}

function exactScale(e: ExactForm, k: Rat): ExactForm {
  return {
    affine: affineScale(e.affine, k),
    rounds: e.rounds.map((r) => ({ ...r, coeff: rMul(r.coeff, k) })),
  };
}

/** Round a rational to `scale` with COBOL semantics (exact, no floats). */
function ratRound(v: Rat, scale: number, mode: "half-up" | "trunc"): Rat {
  const m = 10n ** BigInt(scale);
  const scaled = rMul(v, { n: m, d: 1n }); // want integer part per mode
  const q = scaled.n / scaled.d;
  const rem = scaled.n % scaled.d;
  if (rem === 0n) return rat(q, m);
  if (mode === "trunc") {
    // toward zero
    return rat(q, m);
  }
  // half away from zero: |rem/d| >= 1/2 rounds away
  const away = (rem < 0n ? -rem : rem) * 2n >= scaled.d;
  const adj = away ? (scaled.n < 0n ? q - 1n : q + 1n) : q;
  return rat(adj, m);
}

/** Evaluate an exact form at a full assignment. */
function evalExact(e: ExactForm, x: Assignment): Rat {
  let acc = evalAffine(e.affine, x);
  for (const r of e.rounds) {
    acc = rAdd(acc, rMul(r.coeff, ratRound(evalAffine(r.inner, x), r.scale, r.mode)));
  }
  return acc;
}

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

  const scaleVal = (v: SymVal, k: Rat): SymVal => {
    if (v.kind !== "affine") return v;
    const e = exactOf(v);
    return {
      kind: "affine",
      a: affineScale(v.a, k),
      ...(e && e.rounds.length > 0 ? { exact: exactScale(e, k) } : {}),
    };
  };

  function factor(): SymVal {
    let left = atom();
    while (peek() === "*" || peek() === "/") {
      const op = raw[pos++]!;
      const right = atom();
      if (left.kind !== "affine" || right.kind !== "affine") {
        return left.kind === "opaque" ? left : right.kind === "opaque" ? right : { kind: "opaque", reason: "non-affine operand" };
      }
      if (op === "*") {
        if (isConstant(right.a)) left = scaleVal(left, right.a.c);
        else if (isConstant(left.a)) left = scaleVal(right, left.a.c);
        else return { kind: "opaque", reason: "variable × variable product (nonlinear)" };
      } else {
        if (!isConstant(right.a) || rIsZero(right.a.c)) {
          return { kind: "opaque", reason: "division by a non-constant (nonlinear)" };
        }
        left = scaleVal(left, rDiv({ n: 1n, d: 1n }, right.a.c));
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
      const le = exactOf(left);
      const re = exactOf(right);
      const combinedExact =
        le && re ? exactCombine(le, re, op === "+" ? 1 : -1) : null;
      left = {
        kind: "affine",
        a: affineCombine(left.a, right.a, op === "+" ? 1 : -1),
        ...(combinedExact && combinedExact.rounds.length > 0 ? { exact: combinedExact } : {}),
      };
    }
    return left;
  }

  const negate = (v: SymVal): SymVal => scaleVal(v, { n: -1n, d: 1n });

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
  /**
   * Exact structure of the decision value when representable. With it, the
   * constraint is decidable at any concrete assignment (no fuzz margin) —
   * this is what lets the solver sit cases exactly on a rounded boundary.
   */
  exact?: ExactForm | null;
}

interface CondOutcome {
  text: string;
  taken: boolean;
  diff: Affine | null; // null = opaque condition
  exact?: ExactForm | null;
}

interface SymCompute {
  stmt: ComputeStmt;
  /** Expression value at the execution point, before the store. */
  exprVal: SymVal;
  /** Environment snapshot at the execution point — factor values for
   *  product linearization must come from here, not the path's end state
   *  (inside a loop they differ by every later iteration). */
  env: Map<string, SymVal>;
}

interface PathState {
  env: Map<string, SymVal>;
  constraints: Constraint[];
  conds: CondOutcome[];
  computes: SymCompute[];
  notes: string[];
}

/**
 * Ordered paragraph names of a PERFORM [target..thru] range, in source
 * order (the paras Map is built in source order, so its keys are that
 * order). Without `thru` the range is the single target paragraph.
 */
export function rangeNames(target: string, thru: string | undefined, paras: Map<string, Paragraph>): string[] {
  if (!thru) return [target];
  const order = [...paras.keys()];
  const i = order.indexOf(target);
  const j = order.indexOf(thru);
  if (i < 0 || j < 0 || j < i) {
    throw new DiffExecError(`layer C: PERFORM ${target} THRU ${thru} is not a valid forward paragraph range`);
  }
  return order.slice(i, j + 1);
}

/** Concatenated statements of the range's paragraphs, in range order. */
export function rangeStatements(names: string[], paras: Map<string, Paragraph>): Statement[] {
  const out: Statement[] = [];
  for (const n of names) {
    const p = paras.get(n);
    if (p) out.push(...p.statements);
  }
  return out;
}

/** True if a go-to appears in `stmts` or nested IF branches. */
function containsGoto(stmts: Statement[]): boolean {
  for (const s of stmts) {
    if (s.kind === "go-to") return true;
    if (s.kind === "if" && (containsGoto(s.then) || containsGoto(s.else ?? []))) return true;
  }
  return false;
}

/**
 * Top-level fall-through chain: COBOL execution starts at the entry paragraph
 * and falls through paragraph to paragraph in source order until a STOP RUN /
 * GOBACK ends it. Forward top-level GO TOs (stage 2 of the GO TO plan) are
 * eliminated structurally while the chain is built: a tail-position GO TO T
 * continues the chain at T inside its own branch, and the sibling branch
 * carries the fall-through continuation — `IF c { GO TO T }; rest` becomes
 * `IF c { chain-from-T } ELSE { chain-from-rest }`. Chains from a given
 * paragraph are memoized and shared, and jumps are strictly forward (the
 * frontend gate enforces it; re-checked here), so the recursion terminates.
 * An unconditional stop-run/goback truncates its list — execute() also
 * terminates paths at any stop-run/goback it reaches, so conditional early
 * exits inside branches are handled at execution time.
 */
export function topLevelChain(paras: Map<string, Paragraph>, entry: string): Statement[] {
  const order = [...paras.keys()];
  const start = order.indexOf(entry);
  if (start < 0) throw new DiffExecError(`entry paragraph ${entry} not found`);
  const memo = new Map<number, Statement[]>();

  const paraChain = (i: number): Statement[] => {
    if (i >= order.length) return [];
    const hit = memo.get(i);
    if (hit) return hit;
    const built = elimList(paras.get(order[i]!)!.statements, i, () => paraChain(i + 1));
    memo.set(i, built);
    return built;
  };

  /**
   * Eliminate top-level GO TOs from a statement list of paragraph `cur`;
   * `cont` supplies the fall-through continuation when the list runs out.
   */
  const elimList = (stmts: Statement[], cur: number, cont: () => Statement[]): Statement[] => {
    const out: Statement[] = [];
    for (let si = 0; si < stmts.length; si++) {
      const s = stmts[si]!;
      const rest = stmts.slice(si + 1);
      if (s.kind === "go-to") {
        const t = order.indexOf(s.target);
        if (t <= cur) {
          throw new DiffExecError(`top-level GO TO ${s.target} is not a strictly forward jump`);
        }
        if (rest.length > 0) {
          throw new DiffExecError(`top-level GO TO ${s.target} is not in tail position`);
        }
        out.push(...paraChain(t));
        return out;
      }
      if (s.kind === "stop-run" || s.kind === "goback") {
        out.push(s); // statements after an unconditional program end are dead
        return out;
      }
      if (s.kind === "if" && (containsGoto(s.then) || containsGoto(s.else ?? []))) {
        // The IF becomes terminal: each branch carries its own continuation —
        // the jump target's chain in a goto branch, the fall-through
        // continuation (rest of this list, then the next paragraph) in the
        // other. Evaluated once and shared between branches when both need it.
        let afterIf: Statement[] | null = null;
        const contAfterIf = (): Statement[] => (afterIf ??= elimList(rest, cur, cont));
        const branch = (b: Statement[]): Statement[] =>
          containsGoto(b) ? elimList(b, cur, contAfterIf) : [...b, ...contAfterIf()];
        out.push({ ...s, then: branch(s.then), else: branch(s.else ?? []) });
        return out;
      }
      out.push(s);
    }
    out.push(...cont());
    return out;
  };

  return paraChain(start);
}

/** True if any GO TO targeting `exit` appears anywhere in `stmts` (nested IFs included). */
function containsGotoTo(stmts: Statement[], exit: string): boolean {
  for (const s of stmts) {
    if (s.kind === "go-to" && s.target === exit) return true;
    if (s.kind === "if" && (containsGotoTo(s.then, exit) || containsGotoTo(s.else ?? [], exit))) return true;
  }
  return false;
}

/** True when the last statement of `block` is a GO TO to `exit` (tail position). */
function tailGotoTo(block: Statement[], exit: string): boolean {
  const last = block[block.length - 1];
  return !!last && last.kind === "go-to" && last.target === exit;
}

/**
 * Structured elimination of the sound GO-TO-exit early-return idiom for one
 * performed range (`exit` = the range's THRU endpoint). A GO TO `exit` in tail
 * position — of the range body, or of exactly one branch of an IF — is rewritten
 * into the if/else IR that already exists: the statements that follow it run
 * only when the jump is NOT taken, so they move into the sibling branch. The
 * rewrite is purely structural and semantics-preserving (the trailing EXIT
 * paragraph is a no-op on every path). Every other placement throws — the
 * frontend gate should already have rejected it, so a throw here is defensive,
 * never a silent drop.
 */
function eliminateExitGotos(stmts: Statement[], exit: string): Statement[] {
  const out: Statement[] = [];
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i]!;
    const rest = stmts.slice(i + 1);
    if (s.kind === "go-to") {
      if (s.target !== exit) {
        throw new DiffExecError(`layer C: GO TO ${s.target} is not the exit ${exit} of its enclosing PERFORM THRU range`);
      }
      if (rest.length > 0) {
        throw new DiffExecError(`layer C: GO TO ${exit} is not in tail position (statements follow it in the same block)`);
      }
      return out; // falling off the block == returning from the range
    }
    if (s.kind === "if") {
      const thenGoto = containsGotoTo(s.then, exit);
      const elseGoto = containsGotoTo(s.else ?? [], exit);
      if (!thenGoto && !elseGoto) {
        out.push({
          ...s,
          then: eliminateExitGotos(s.then, exit),
          ...(s.else ? { else: eliminateExitGotos(s.else, exit) } : {}),
        });
        continue;
      }
      if (thenGoto && elseGoto) {
        throw new DiffExecError(`layer C: GO TO ${exit} in both branches of an IF (unsupported early-exit shape)`);
      }
      if (thenGoto) {
        if (!tailGotoTo(s.then, exit)) {
          throw new DiffExecError(`layer C: GO TO ${exit} nested below the tail of an IF then-branch (needs stage-2 flag elimination)`);
        }
        out.push({
          ...s,
          then: eliminateExitGotos(s.then.slice(0, -1), exit),
          else: eliminateExitGotos([...(s.else ?? []), ...rest], exit),
        });
      } else {
        if (!tailGotoTo(s.else ?? [], exit)) {
          throw new DiffExecError(`layer C: GO TO ${exit} nested below the tail of an IF else-branch (needs stage-2 flag elimination)`);
        }
        out.push({
          ...s,
          then: eliminateExitGotos([...s.then, ...rest], exit),
          else: eliminateExitGotos((s.else ?? []).slice(0, -1), exit),
        });
      }
      return out; // the statements after this IF were consumed into a branch
    }
    out.push(s); // any other kind carries no GO TO
  }
  return out;
}

/** Inline PERFORMed paragraphs so paths are enumerated over one statement tree. */
export function inlineStatements(stmts: Statement[], paras: Map<string, Paragraph>, stack: string[]): Statement[] {
  const out: Statement[] = [];
  for (const s of stmts) {
    if (s.kind === "perform") {
      const names = rangeNames(s.target, s.thru, paras);
      if (names.some((n) => stack.includes(n))) {
        throw new DiffExecError(
          `layer C: PERFORM cycle through ${s.target}${s.thru ? ` THRU ${s.thru}` : ""}; loops need fixpoint machinery`,
        );
      }
      let body = inlineStatements(rangeStatements(names, paras), paras, [...stack, ...names]);
      // A PERFORM <s> THRU <exit> range is where the sound GO-TO-exit idiom is
      // rewritten into if/else: the range's THRU endpoint is the return target.
      if (s.thru) body = eliminateExitGotos(body, s.thru);
      out.push(...body);
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
  /** PICTURE scale of each input variable (by stdin position). */
  inputScales: number[];
  paras: Map<string, Paragraph>;
  /** Max iterations to unroll per PERFORM loop. */
  maxUnroll: number;
  /** Cache of inlined loop bodies by target paragraph. */
  loopBodies: Map<string, Statement[]>;
}

function exprCtxFor(state: PathState, ctx: ExecCtx): ExprCtx {
  return { env: state.env, items: ctx.items, assigned: ctx.assigned, inputSpec: (i) => i };
}

type LoopStmt = Extract<Statement, { kind: "perform-times" | "perform-until" | "perform-varying" }>;

/** The inlined body of a PERFORM loop — its [target..thru] paragraph range. */
function loopBody(ctx: ExecCtx, s: LoopStmt): Statement[] {
  const names = rangeNames(s.target, s.thru, ctx.paras);
  const key = names.join("|");
  let body = ctx.loopBodies.get(key);
  if (!body) {
    body = inlineStatements(rangeStatements(names, ctx.paras), ctx.paras, [...names]);
    if (containsAccept(body, ctx, new Set(names))) {
      throw new DiffExecError(
        `layer C: ACCEPT inside PERFORM loop body ${key} — stdin positions become iteration-dependent (needs the record protocol)`,
      );
    }
    if (containsStop(body)) {
      throw new DiffExecError(
        `layer C: STOP RUN/GOBACK inside PERFORM loop body ${key} — mid-loop program exit is not modeled by the unroller yet`,
      );
    }
    ctx.loopBodies.set(key, body);
  }
  return body;
}

/** True if a stop-run/goback appears in `stmts` or nested IF branches. */
function containsStop(stmts: Statement[]): boolean {
  for (const s of stmts) {
    if (s.kind === "stop-run" || s.kind === "goback") return true;
    if (s.kind === "if" && (containsStop(s.then) || containsStop(s.else ?? []))) return true;
  }
  return false;
}

function containsAccept(stmts: Statement[], ctx: ExecCtx, seen: Set<string>): boolean {
  for (const s of stmts) {
    if (s.kind === "accept") return true;
    if (s.kind === "if") {
      if (containsAccept(s.then, ctx, seen) || containsAccept(s.else ?? [], ctx, seen)) return true;
    }
    if (s.kind === "perform-times" || s.kind === "perform-until" || s.kind === "perform-varying") {
      const names = rangeNames(s.target, s.thru, ctx.paras);
      if (!names.some((n) => seen.has(n))) {
        names.forEach((n) => seen.add(n));
        if (containsAccept(inlineStatements(rangeStatements(names, ctx.paras), ctx.paras, names), ctx, seen)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Every name the loop can write (body recursively, plus the control var). */
function loopWrites(ctx: ExecCtx, s: LoopStmt): Set<string> {
  const out = new Set<string>();
  if (s.kind === "perform-varying") out.add(s.varying.var);
  collectWrites(loopBody(ctx, s), out, ctx, new Set(rangeNames(s.target, s.thru, ctx.paras)));
  return out;
}

function collectWrites(stmts: Statement[], out: Set<string>, ctx: ExecCtx, seen: Set<string>): void {
  for (const s of stmts) {
    if (s.kind === "move") for (const t of s.to) out.add(t);
    else if (s.kind === "compute") out.add(s.target);
    else if (s.kind === "accept") out.add(s.target);
    else if (s.kind === "if") {
      collectWrites(s.then, out, ctx, seen);
      collectWrites(s.else ?? [], out, ctx, seen);
    } else if (s.kind === "perform-times" || s.kind === "perform-until" || s.kind === "perform-varying") {
      if (s.kind === "perform-varying") out.add(s.varying.var);
      const names = rangeNames(s.target, s.thru, ctx.paras);
      if (!names.some((n) => seen.has(n))) {
        names.forEach((n) => seen.add(n));
        collectWrites(inlineStatements(rangeStatements(names, ctx.paras), ctx.paras, names), out, ctx, seen);
      }
    }
  }
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

  // A value is on the target grid — no truncation/rounding at store time —
  // when its affine part lands on the grid for every on-grid input (judged
  // per input scale) and every rounded term's contribution does too.
  const affineOnGrid = (a: Affine): boolean =>
    rMul(a.c, { n: grid, d: 1n }).d === 1n &&
    [...a.terms.entries()].every(
      ([i, c]) => rMul(c, rat(grid, 10n ** BigInt(ctx.inputScales[i] ?? 0))).d === 1n,
    );
  const incoming = exactOf(val);
  const gridExact = incoming
    ? affineOnGrid(incoming.affine) &&
      incoming.rounds.every((r) => rMul(rMul(r.coeff, ulpOf(r.scale)), { n: grid, d: 1n }).d === 1n)
    : false;

  let fuzz = val.a.fuzz;
  let exactForm: ExactForm | undefined;
  if (gridExact && incoming) {
    // Store is the identity; the exact form (if it has structure) survives.
    if (incoming.rounds.length > 0) exactForm = incoming;
  } else {
    const u = ulpOf(scale);
    fuzz = rAdd(fuzz, rounded ? rDiv(u, { n: 2n, d: 1n }) : u);
    // The stored value is exactly round(inner) when the incoming value is
    // itself drift-free and affine; one more rounding level drops the form.
    if (incoming && incoming.rounds.length === 0) {
      exactForm = {
        affine: affineConst(R0),
        rounds: [{ coeff: { n: 1n, d: 1n }, mode: rounded ? "half-up" : "trunc", scale, inner: incoming.affine }],
      };
    }
  }
  const storedVal: Affine = { terms: val.a.terms, c: val.a.c, fuzz };
  state.env.set(target, { kind: "affine", a: storedVal, ...(exactForm ? { exact: exactForm } : {}) });
  // Capacity: constrain the path to the wrap-free region — solutions the
  // solver produces stay in the linear regime; wrap semantics belong to
  // layers A/B, which sample it.
  if (digits !== undefined && item?.type?.category === "numeric") {
    const max = rat(10n ** BigInt(digits) - 1n, grid);
    const storedExact: ExactForm | null =
      exactForm ?? (rIsZero(storedVal.fuzz) ? { affine: storedVal, rounds: [] } : null);
    state.constraints.push({
      diff: storedVal,
      op: ">=",
      taken: true,
      text: `${target} >= 0 (storage)`,
      domain: true,
      exact: storedExact,
    });
    state.constraints.push({
      diff: affineCombine(storedVal, affineConst(max), -1),
      op: "<=",
      taken: true,
      text: `${target} <= ${ratToDecimal(max, scale)} (storage)`,
      domain: true,
      exact: storedExact ? exactCombine(storedExact, { affine: affineConst(max), rounds: [] }, -1) : null,
    });
  }
}

function parseCondition(
  text: string,
  ctx: ExprCtx,
): { diff: Affine; op: CmpOp; exact: ExactForm | null } | null {
  const m = /^(.*?)\s*(>=|<=|<>|>|<|=)\s*(.*)$/.exec(text.trim());
  if (!m) return null;
  const left = parseExpression(m[1]!, ctx);
  const right = parseExpression(m[3]!, ctx);
  if (left.kind !== "affine" || right.kind !== "affine") return null;
  const le = exactOf(left);
  const re = exactOf(right);
  return {
    diff: affineCombine(left.a, right.a, -1),
    op: m[2] as CmpOp,
    exact: le && re ? exactCombine(le, re, -1) : null,
  };
}

function execute(stmts: Statement[], state: PathState, ctx: ExecCtx, out: PathState[]): void {
  const exprCtx = (): ExprCtx => exprCtxFor(state, ctx);
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
        state.computes.push({ stmt: s, exprVal: v, env: new Map(state.env) });
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
          forked.conds.push({ text: s.condition.text, taken, diff: parsed?.diff ?? null, exact: parsed?.exact ?? null });
          if (parsed) {
            forked.constraints.push({ diff: parsed.diff, op: parsed.op, taken, text: s.condition.text, exact: parsed.exact });
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
      case "perform-times":
      case "perform-until":
      case "perform-varying": {
        executeLoop(s, state, stmts.slice(si + 1), ctx, out);
        return; // every fork continued with the rest of the statements
      }
      case "display":
      case "exit":
        break; // flow-neutral for the symbolic store
      case "stop-run":
      case "goback":
        // Program end: this path is complete here — statements after it (the
        // rest of an IF fork, or fall-through paragraphs) never run on it.
        out.push(state);
        return;
      case "perform":
        break; // already inlined; unresolved targets have no body to run
      case "go-to":
        // Sound GO-TO-exit is rewritten to if/else in inlineStatements before
        // execution; reaching one here means an unhandled shape slipped through.
        throw new DiffExecError(`layer C: GO TO ${s.target} survived structured elimination`);
      default: {
        const never: never = s;
        throw new DiffExecError(`layer C: unsupported statement kind ${(never as Statement).kind}`);
      }
    }
  }
  out.push(state);
}

// ---------------------------------------------------------------------------
// PERFORM loop unrolling (TEST BEFORE semantics).
// ---------------------------------------------------------------------------

function executeLoop(s: LoopStmt, state: PathState, rest: Statement[], ctx: ExecCtx, out: PathState[]): void {
  loopBody(ctx, s); // prime the body cache and run its ACCEPT check once
  // VARYING: var := from happens before the first test.
  if (s.kind === "perform-varying") {
    const from = parseExpression(s.varying.from.text, exprCtxFor(state, ctx));
    store(state, ctx, s.varying.var, from, false);
  }
  // TIMES: the count is evaluated once, before the first iteration —
  // snapshot it so a body that writes the count operand cannot skew it.
  const timesVal = s.kind === "perform-times" ? parseExpression(s.times.text, exprCtxFor(state, ctx)) : null;
  unrollLoop(s, timesVal, state, rest, ctx, out, 0);
}

/** A constraint with a drift-free constant decision value that fails is a
 *  contradiction — the branch it guards cannot execute. */
function provablyFalse(c: Constraint): boolean {
  return (
    c.diff.terms.size === 0 &&
    rIsZero(c.diff.fuzz) &&
    (!c.exact || c.exact.rounds.length === 0) &&
    constraintHolds(c, []) === false
  );
}

function unrollLoop(
  s: LoopStmt,
  timesVal: SymVal | null,
  state: PathState,
  rest: Statement[],
  ctx: ExecCtx,
  out: PathState[],
  depth: number,
): void {
  // --- exit branch: TEST BEFORE, leaving after `depth` iterations ---
  const exitState = cloneState(state);
  pushLoopCond(s, timesVal, exitState, ctx, depth, true);
  // Eager pruning: a constant-false exit (e.g. `3 TIMES` at depth 1) would
  // multiply enumerated-but-dead paths; drop it here, provably.
  const exitDead = exitState.constraints.length > 0 && provablyFalse(exitState.constraints[exitState.constraints.length - 1]!);
  if (!exitDead) {
    execute(rest, exitState, ctx, out);
    if (out.length > MAX_PATHS) {
      throw new DiffExecError(`layer C: more than ${MAX_PATHS} paths; lower maxLoopUnroll or split the module`);
    }
  }

  // --- unroll bound reached: the deeper input region is disclosed, never
  //     dropped — an unknown-coverage path with poisoned loop writes.
  if (depth >= ctx.maxUnroll) {
    const trunc = cloneState(state);
    trunc.conds.push({
      text: `${s.text} exceeds the unroll bound of ${ctx.maxUnroll} iteration(s)`,
      taken: true,
      diff: null,
      exact: null,
    });
    for (const name of loopWrites(ctx, s)) {
      trunc.env.set(name, { kind: "opaque", reason: `written beyond the loop unroll bound (${s.text})` });
    }
    trunc.notes.push(
      `${s.text}: the input region needing more than ${ctx.maxUnroll} iterations is not enumerated symbolically`,
    );
    execute(rest, trunc, ctx, out);
    return;
  }

  // --- iterate branch: condition says continue; run the body once ---
  const iter = cloneState(state);
  pushLoopCond(s, timesVal, iter, ctx, depth, false);
  // Constant-false continue (e.g. `3 TIMES` at depth 3) terminates the
  // unroll exactly — no deeper dead forks.
  if (iter.constraints.length > 0 && provablyFalse(iter.constraints[iter.constraints.length - 1]!)) {
    return;
  }
  const bodyOut: PathState[] = [];
  execute(loopBody(ctx, s), iter, ctx, bodyOut);
  for (const bs of bodyOut) {
    if (s.kind === "perform-varying") {
      const next = parseExpression(`${s.varying.var} + ${s.varying.by.text}`, exprCtxFor(bs, ctx));
      store(bs, ctx, s.varying.var, next, false);
    }
    unrollLoop(s, timesVal, bs, rest, ctx, out, depth + 1);
  }
}

/** Push the loop's continue/exit decision for iteration `depth` as a
 *  constraint (TIMES: count = / > depth; UNTIL/VARYING: the condition in
 *  the current environment). */
function pushLoopCond(
  s: LoopStmt,
  timesVal: SymVal | null,
  st: PathState,
  ctx: ExecCtx,
  depth: number,
  exit: boolean,
): void {
  if (s.kind === "perform-times") {
    const label = `${s.text}: iteration count ${exit ? "=" : ">"} ${depth}`;
    if (timesVal?.kind === "affine") {
      const depthConst = { affine: affineConst(rat(BigInt(depth), 1n)), rounds: [] as RoundTerm[] };
      const diff = affineCombine(timesVal.a, depthConst.affine, -1);
      const ex = exactOf(timesVal);
      const exact = ex ? exactCombine(ex, depthConst, -1) : null;
      st.conds.push({ text: label, taken: true, diff, exact });
      st.constraints.push({ diff, op: exit ? "=" : ">", taken: true, text: label, exact });
    } else {
      st.conds.push({ text: label, taken: true, diff: null, exact: null });
      st.notes.push(`TIMES count "${s.times.text}" is not analyzable; loop constraints incomplete`);
    }
  } else {
    const parsed = parseCondition(s.condition.text, exprCtxFor(st, ctx));
    st.conds.push({ text: s.condition.text, taken: exit, diff: parsed?.diff ?? null, exact: parsed?.exact ?? null });
    if (parsed) {
      st.constraints.push({
        diff: parsed.diff,
        op: parsed.op,
        taken: exit,
        text: `${s.condition.text} (${exit ? `exit after ${depth} iteration(s)` : `iteration ${depth + 1}`})`,
        exact: parsed.exact,
      });
    } else {
      st.notes.push(`loop condition "${s.condition.text}" is not affine; path constraints incomplete`);
    }
  }
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
  // Exact structure available: the decision is fully decidable — evaluate
  // the rounding for real instead of hedging with a fuzz band.
  if (c.exact) {
    return cmp(rCmp(evalExact(c.exact, x), R0)) === c.taken;
  }
  const v = evalAffine(c.diff, x);
  const f = c.diff.fuzz;
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

function solveCongruence(
  k: bigint,
  h: bigint,
  m: bigint,
  maxSolutions: number,
  maxX: bigint,
  minX: bigint = 0n,
): bigint[] {
  const kk = ((k % m) + m) % m;
  const hh = ((h % m) + m) % m;
  const [g] = egcd(kk === 0n ? m : kk, m);
  if (hh % g !== 0n) return [];
  const m2 = m / g;
  const k2 = (kk / g) % m2;
  const h2 = (hh / g) % m2;
  const [, inv] = egcd(k2 === 0n ? m2 : k2, m2);
  const x0 = m2 === 0n ? 0n : ((h2 * (((inv % m2) + m2) % m2)) % m2 + m2) % m2;
  // Skip ahead to the first solution at or above the path's lower bound, so a
  // rounded compute gated behind a threshold (score >= 60, balance >= 500)
  // yields boundary inputs in the feasible region rather than below it. The
  // caller still filters every solution against the full constraint set, so
  // an approximate bound only affects *where* the search starts, not
  // soundness.
  const lo = minX > 1n ? minX : 1n;
  let tStart = 0n;
  if (m2 > 0n && x0 < lo) {
    tStart = (lo - x0 + m2 - 1n) / m2; // ceil((lo - x0) / m2)
  }
  const out: bigint[] = [];
  for (let t = tStart; out.length < maxSolutions; t++) {
    const sol = x0 + t * m2;
    if (sol > maxX) break;
    if (sol > 0n) out.push(sol);
  }
  return out;
}

const negateOp = (op: CmpOp): CmpOp =>
  ({ ">": "<=", ">=": "<", "<": ">=", "<=": ">", "=": "<>", "<>": "=" } as const)[op];
const flipOp = (op: CmpOp): CmpOp =>
  ({ ">": "<", ">=": "<=", "<": ">", "<=": ">=", "=": "=", "<>": "<>" } as const)[op];

/**
 * A conservative lower bound (scaled to the free variable's PICTURE grid)
 * on input `j`, derived from single-variable drift-free path constraints
 * such as `WS-SCORE >= 60`. Returns null when no such lower bound exists.
 * Under-estimates on purpose (floors to the grid): a loose bound only moves
 * the search start; correctness comes from the caller's constraint filter.
 */
function freeVarLowerBoundScaled(constraints: Constraint[], j: number, scale: number): bigint | null {
  let lo: Rat | null = null;
  for (const c of constraints) {
    if (!rIsZero(c.diff.fuzz)) continue;
    if (c.exact && c.exact.rounds.length > 0) continue;
    if (c.diff.terms.size !== 1) continue; // single-variable constraints only
    const A = c.diff.terms.get(j);
    if (A === undefined || rIsZero(A)) continue;
    const xStar = rDiv(rNeg(c.diff.c), A); // boundary value of x_j
    const effOp = c.taken ? c.op : negateOp(c.op);
    const rel = rCmp(A, R0) > 0 ? effOp : flipOp(effOp); // x_j `rel` xStar
    if ((rel === ">" || rel === ">=" || rel === "=") && (lo === null || rCmp(xStar, lo) > 0)) {
      lo = xStar;
    }
  }
  if (lo === null) return null;
  const scaled = rMul(lo, { n: 10n ** BigInt(scale), d: 1n });
  // floor toward -inf so the bound never overshoots the smallest valid grid point
  return scaled.n >= 0n ? scaled.n / scaled.d : -((-scaled.n + scaled.d - 1n) / scaled.d);
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
      else if (s.kind === "perform-varying") assigned.add(s.varying.var);
      else if (s.kind === "if") {
        collectAssigned(s.then);
        collectAssigned(s.else ?? []);
      }
    }
  };
  for (const p of ir.procedureDivision.paragraphs) collectAssigned(p.statements);

  // --- 1. symbolic execution over every path ---------------------------------
  const paras = new Map(ir.procedureDivision.paragraphs.map((p) => [p.name, p]));
  if (!paras.has(ir.controlFlow.entry)) {
    throw new DiffExecError(`layer C: entry paragraph ${ir.controlFlow.entry} not found`);
  }
  // Execute the full top-level fall-through chain, not just the entry
  // paragraph: COBOL control falls through paragraph to paragraph until a
  // STOP RUN/GOBACK, which execute() honors as a path terminator.
  const tree = inlineStatements(topLevelChain(paras, ir.controlFlow.entry), paras, [ir.controlFlow.entry]);

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

  const ctx: ExecCtx = {
    items,
    assigned,
    acceptOrder,
    inputScales: inputs.map((s) => s.scale),
    paras,
    maxUnroll: sym.maxLoopUnroll ?? 12,
    loopBodies: new Map(),
  };
  const states: PathState[] = [];
  execute(tree, { env: new Map(), constraints: [], conds: [], computes: [], notes: [] }, ctx, states);
  const paths = states.map((st, i) => ({ id: i, state: st }));

  console.log(`legacymind verify (layer C: path-sensitive symbolic engine)`);
  console.log(`  legacy: ${sideLabel(config.legacy)}`);
  console.log(`  modern: ${sideLabel(config.modern)}`);
  console.log(`  paths enumerated: ${paths.length}; money pattern: /${moneyRe.source}/`);
  console.log("");

  // Fixed-value candidates for the solver: the base case, then zeros.
  const baseAssign: Assignment = sym.baseCase.map((v, i) => (inputs[i]!.numeric ? ratOf(v) : null));
  const zeroAssign: Assignment = inputs.map((s) => (s.numeric ? R0 : null));
  const fixedCandidates = [baseAssign, zeroAssign];

  const toStdin = (x: Assignment): string[] =>
    x.map((v, i) => (v === null ? sym.baseCase[i]! : ratToDecimal(v, inputs[i]!.scale) ?? sym.baseCase[i]!));

  // --- 2. infeasible paths (proved, not guessed) -------------------------------
  // Two proof shapes, both exact; a failed witness search alone is never
  // treated as proof:
  //   (a) a drift-free constant decision value that fails — a contradiction;
  //   (b) a single-variable decision value whose required sign is
  //       unachievable anywhere in that input's PICTURE domain [0, max].
  const opAchievableInRange = (c: Constraint, lo: Rat, hi: Rat): boolean => {
    switch (c.op) {
      case ">": return c.taken ? rCmp(hi, R0) > 0 : rCmp(lo, R0) <= 0;
      case "<": return c.taken ? rCmp(lo, R0) < 0 : rCmp(hi, R0) >= 0;
      case ">=": return c.taken ? rCmp(hi, R0) >= 0 : rCmp(lo, R0) < 0;
      case "<=": return c.taken ? rCmp(lo, R0) <= 0 : rCmp(hi, R0) > 0;
      case "=": return c.taken ? rCmp(lo, R0) <= 0 && rCmp(hi, R0) >= 0 : !(rIsZero(lo) && rIsZero(hi));
      case "<>": return c.taken ? !(rIsZero(lo) && rIsZero(hi)) : rCmp(lo, R0) <= 0 && rCmp(hi, R0) >= 0;
    }
  };
  const infeasible = paths.map((p) =>
    p.state.constraints.some((c) => {
      if (!rIsZero(c.diff.fuzz) || (c.exact && c.exact.rounds.length > 0)) return false;
      if (c.diff.terms.size === 0) {
        return constraintHolds(c, zeroAssign) === false;
      }
      if (c.diff.terms.size === 1) {
        const [j, k] = [...c.diff.terms.entries()][0]!;
        const spec = inputs[j];
        if (!spec?.numeric) return false;
        const atMax = rAdd(c.diff.c, rMul(k, spec.max));
        const lo = rCmp(k, R0) > 0 ? c.diff.c : atMax;
        const hi = rCmp(k, R0) > 0 ? atMax : c.diff.c;
        return !opAchievableInRange(c, lo, hi);
      }
      return false;
    }),
  );

  // --- 3. path witnesses (solved first: their assignments seed the
  //         obligation solver with in-path fixing points) -----------------------
  interface Witness {
    path: number;
    stdin: string[] | null;
    assign: Assignment | null;
    note: string;
    result?: CaseResult;
  }
  const witnesses: Witness[] = paths.map((p) => {
    if (infeasible[p.id]) {
      return { path: p.id, stdin: null, assign: null, note: "path is proven infeasible (a constraint cannot hold over the input domain); dead code" };
    }
    if (p.state.conds.some((c) => !c.diff)) {
      return { path: p.id, stdin: null, assign: null, note: "path has a non-affine condition; witness selection is not sound" };
    }
    const tried: Assignment[] = [...fixedCandidates];
    // Budget scales with the unroll bound: reaching a depth-k loop path
    // takes ~k single-constraint repairs interleaved with dead ends.
    const maxRounds = Math.max(8, 4 + 2 * ctx.maxUnroll);
    for (let round = 0; round < maxRounds; round++) {
      const x = tried.shift();
      if (!x) break;
      if (x.some((v, i) => inputs[i]!.numeric && v === null)) continue;
      const ok = allConstraintsHold(p.state.constraints, x);
      if (ok === true) {
        return { path: p.id, stdin: toStdin(x), assign: x, note: `witness for path #${p.id}` };
      }
      // Find the first violated/marginal constraint and repair just that
      // one, queuing the result UNVALIDATED — the outer loop re-checks
      // everything and repairs the next violation, so constraint chains
      // (one loop iteration per step) are walked out incrementally.
      for (const c of p.state.constraints) {
        if (constraintHolds(c, x) === true) continue;
        const scales = [...c.diff.terms.keys()].map((i) => inputs[i]?.scale ?? 0);
        const ulp = ulpOf(scales.length > 0 ? Math.max(...scales) : 0);
        const margin = rAdd(c.diff.fuzz, ulp);
        const exact = rIsZero(c.diff.fuzz);
        // Closest satisfying decision value: a drift-free non-strict
        // requirement is satisfied AT the boundary; overshooting it by a
        // margin would jump over equality-sandwiched regions (term = k).
        let target: Rat;
        if ((c.op === "=" && c.taken) || (c.op === "<>" && !c.taken)) {
          target = R0;
        } else if (c.op === ">" || c.op === ">=") {
          // taken: need diff > 0 (strict for ">") / >= 0; not-taken: mirrored below zero
          if (c.taken) target = c.op === ">=" && exact ? R0 : margin;
          else target = c.op === ">" && exact ? R0 : rNeg(margin);
        } else if (c.op === "<" || c.op === "<=") {
          if (c.taken) target = c.op === "<=" && exact ? R0 : rNeg(margin);
          else target = c.op === "<" && exact ? R0 : margin;
        } else {
          target = margin; // "=" not-taken / "<>" taken
        }
        const solved = solveEquality(c.diff, target, inputs, [x], []);
        if (solved) tried.push(solved);
        break;
      }
    }
    return { path: p.id, stdin: null, assign: null, note: "no assignment satisfied all path constraints (see constraints in report)" };
  });

  /** Fixing points for a path's solver runs: its witness first, then globals. */
  const fixedCandidatesFor = (pathId: number): Assignment[] => {
    const w = witnesses[pathId]?.assign;
    return w ? [w, ...fixedCandidates] : fixedCandidates;
  };

  // --- 4. branch-boundary obligations -----------------------------------------
  // A condition's decision value is path-dependent (an accumulator may be
  // degenerate on one path and fully affine on another), so each unique
  // condition is solved against every path's own diff — and when the
  // decision value passes through a rounded store, its exact form is
  // inverted through the rounding.
  const obligations: Obligation[] = [];
  const condSites = new Map<string, Map<number, { diff: Affine | null; exact: ExactForm | null }>>();
  for (const path of paths) {
    if (infeasible[path.id]) continue;
    for (const c of path.state.conds) {
      let site = condSites.get(c.text);
      if (!site) {
        site = new Map();
        condSites.set(c.text, site);
      }
      if (!site.has(path.id)) site.set(path.id, { diff: c.diff, exact: c.exact ?? null });
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
    // Directly affine decision values (no drift) and exact single-rounding
    // forms are both solvable; anything else is disclosed.
    const affineSites = [...perPath.entries()].filter(
      (e): e is [number, { diff: Affine; exact: ExactForm | null }] =>
        e[1].diff !== null && rIsZero(e[1].diff.fuzz) && e[1].diff.terms.size > 0,
    );
    const roundSites = [...perPath.entries()].filter(
      (e): e is [number, { diff: Affine | null; exact: ExactForm }] =>
        e[1].exact !== null &&
        e[1].exact.rounds.length === 1 &&
        e[1].exact.affine.terms.size === 0 &&
        e[1].exact.rounds[0]!.inner.terms.size > 0,
    );
    if (affineSites.length === 0 && roundSites.length === 0) {
      const any = [...perPath.values()].find((x) => x.diff !== null);
      ob.notes.push(
        any === undefined
          ? "condition is not an affine form on any path; needs nonlinear reasoning"
          : any.diff !== null && !rIsZero(any.diff.fuzz)
            ? "condition value drifts through more than one rounded store; needs deeper inversion"
            : "condition decision value is constant on every feasible path",
      );
      continue;
    }
    for (const [suffix, offset, label] of [
      ["m", -1n, "boundary - 1ulp"],
      ["0", 0n, "boundary"],
      ["p", 1n, "boundary + 1ulp"],
    ] as const) {
      let solved: Assignment | null = null;
      let solvedPath = -1;
      let how = "";
      for (const [pathId, site] of affineSites) {
        const diff = site.diff;
        const scales = [...diff.terms.keys()].map((i) => inputs[i]?.scale ?? 0);
        const u = ulpOf(scales.length > 0 ? Math.max(...scales) : 0);
        const target = rMul(u, { n: offset, d: 1n });
        solved = solveEquality(diff, target, inputs, fixedCandidatesFor(pathId), paths[pathId]!.state.constraints);
        if (solved) {
          solvedPath = pathId;
          how = "linear";
          break;
        }
      }
      if (!solved) {
        for (const [pathId, site] of roundSites) {
          solved = solveThroughRounding(
            site.exact,
            offset,
            inputs,
            fixedCandidatesFor(pathId),
            paths[pathId]!.state.constraints,
          );
          if (solved) {
            solvedPath = pathId;
            how = "inverted through the rounded store";
            break;
          }
        }
      }
      if (solved) {
        ob.cases.push({
          id: `sym-${ob.id}-${suffix}`,
          stdin: toStdin(solved),
          note: `${condText} decision value at ${label} (path #${solvedPath}, ${how})`,
        });
      } else {
        ob.notes.push(`no on-grid inputs reach ${label} within any path's constraints`);
      }
    }
  }

  // --- 5. rounding half-boundary obligations -----------------------------------
  // Gather each unique money-touching ROUNDED compute with its per-path
  // expression value — the same statement can be affine on one path and
  // degenerate (constant) on another, so realization is chosen per path.
  interface RoundedSite {
    cmp: ComputeStmt;
    perPath: Map<number, SymCompute>;
  }
  const roundedSites = new Map<string, RoundedSite>();
  for (const path of paths) {
    if (infeasible[path.id]) continue;
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
      // First occurrence per path = the earliest loop iteration, where the
      // expression is least drifted and most solvable.
      if (!site.perPath.has(path.id)) site.perPath.set(path.id, sc);
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
    let anySolvable = false;
    let anyBoundaryExists = false;

    /**
     * Realize half-boundary cases for an affine view of the expression on
     * one path, using the given fixing points. Returns "realized",
     * "no-boundary" (exact at target scale), or "failed".
     */
    const tryCongruence = (
      a: Affine,
      pathId: number,
      fixedList: Assignment[],
      viaNote: string,
    ): "realized" | "no-boundary" | "failed" => {
      const path = paths[pathId]!;
      // L = the scale at which the expression is integral for on-grid
      // inputs; a half-unit at the target scale is then m/2, m = 10^(L-st).
      let scaleL = 0;
      for (const [i, coeff] of a.terms) {
        const si = inputs[i]?.scale ?? 0;
        const s = pow10Scale(rMul(coeff, { n: 1n, d: 10n ** BigInt(si) }).d);
        if (s === null) return "failed"; // non-decimal coefficient
        scaleL = Math.max(scaleL, s);
      }
      const s0 = pow10Scale(a.c.d);
      if (s0 === null) return "failed";
      scaleL = Math.max(scaleL, s0);
      const modExp = scaleL - st;
      if (modExp <= 0) return "no-boundary";
      anyBoundaryExists = true;
      const m = 10n ** BigInt(modExp);
      const h = m / 2n;
      const scaleMul = 10n ** BigInt(scaleL);
      let realizedOnPath = false;
      for (const fixed of fixedList) {
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
          const minXInt = freeVarLowerBoundScaled(path.state.constraints, j, spec.scale);
          const sols = solveCongruence(
            kScaled.n,
            ((h - (restScaled.n % m)) % m + m) % m,
            m,
            maxSolutions,
            maxXInt.d === 1n ? maxXInt.n : 0n,
            minXInt !== null && minXInt > 0n ? minXInt : 0n,
          );
          for (const sol of sols) {
            const x: Assignment = [...fixed];
            x[j] = rat(sol, 10n ** BigInt(spec.scale));
            if (allConstraintsHold(path.state.constraints, x) !== true) continue;
            ob.cases.push({
              id: `sym-${ob.id}-p${pathId}-${ob.cases.length}`,
              stdin: toStdin(x),
              note: `${spec.name} = ${ratToDecimal(x[j]!, spec.scale)} lands ${cmp.target} on a half-${st === 0 ? "unit" : "cent"} (path #${pathId}${viaNote})`,
            });
            realizedOnPath = true;
            if (ob.cases.length >= maxSolutions * 2) break;
          }
        }
      }
      return realizedOnPath ? "realized" : "failed";
    };

    for (const [pathId, siteCompute] of site.perPath) {
      const exprVal = siteCompute.exprVal;
      const path = paths[pathId]!;
      if (exprVal.kind === "affine" && rIsZero(exprVal.a.fuzz) && exprVal.a.terms.size > 0) {
        anySolvable = true;
        const r = tryCongruence(exprVal.a, pathId, fixedCandidatesFor(pathId), "");
        if (r === "no-boundary") {
          ob.unrealizedPaths.push({ path: pathId, reason: "expression is exact at the target scale on this path" });
        } else if (r === "failed") {
          ob.unrealizedPaths.push({
            path: pathId,
            reason: "the half-boundary congruence has no on-grid solution within this path's constraints",
          });
        }
        continue;
      }
      if (exprVal.kind === "affine" && exprVal.a.terms.size === 0) {
        ob.unrealizedPaths.push({ path: pathId, reason: "expression is constant on this path (no input can move it)" });
        continue;
      }
      if (exprVal.kind === "affine") {
        ob.unrealizedPaths.push({ path: pathId, reason: "expression carries rounding drift on this path" });
        continue;
      }
      // Nonlinear (variable × variable): linearize by fixing all factors
      // but one at this path's witness values, which satisfy the path
      // constraints by construction. Factor values come from the compute
      // point's environment snapshot.
      const linear = linearizeProduct(cmp, siteCompute.env, inputs, witnesses[pathId]?.assign ?? baseAssign, items, assigned);
      if (linear) {
        anySolvable = true;
        const r = tryCongruence(linear.a, pathId, [linear.fixed], ` via ${linear.desc}`);
        if (r === "realized") continue;
        ob.unrealizedPaths.push({
          path: pathId,
          reason:
            r === "no-boundary"
              ? "expression is exact at the target scale with the witness-fixed factors"
              : "no on-grid solution with the witness-fixed factors within this path's constraints",
        });
        continue;
      }
      ob.unrealizedPaths.push({
        path: pathId,
        reason: exprVal.kind === "opaque" ? exprVal.reason : "expression is not a numeric value on this path",
      });
    }

    if (ob.cases.length > 0) {
      ob.notes.push(`affine congruence solved: expression ≡ half-unit (mod target grid) at target scale ${st}`);
    } else if (anySolvable && !anyBoundaryExists && ob.unrealizedPaths.every((u) => u.reason.includes("exact at the target scale"))) {
      ob.status = "NOT-APPLICABLE";
      ob.notes.push("the expression is exact at the target scale on every path; no rounding boundary exists");
    } else if (!anySolvable) {
      // v1 fallback: source * constant with an invertible producer.
      ob.notes.push("affine engine: expression not solvable on any path; falling back to producer-inversion heuristic");
      ob.unrealizedPaths = [];
      legacyRoundingRealization(ob, cmp, paths, inputs, sym.baseCase, items, assigned, maxSolutions, st);
    }
  }

  // --- 6. execute all realized cases ---------------------------------------------
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

  // --- 7. path coverage ------------------------------------------------------------
  const allObCases = obligations.flatMap((o) => o.cases);
  const pathCoverage = paths.map((p) => {
    const conds = p.state.conds.map((c) => `${c.text} = ${c.taken}`);
    if (infeasible[p.id]) {
      return { id: p.id, conds, covered: "infeasible" as const };
    }
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
    version: "0.3.0",
    generatedAt: new Date().toISOString(),
    verdict,
    summary: {
      obligations: counts,
      cases: caseCounts,
      paths: {
        total: paths.length,
        covered: pathCoverage.filter((p) => p.covered === true).length,
        unknown: pathCoverage.filter((p) => p.covered === "unknown").length,
        infeasible: pathCoverage.filter((p) => p.covered === "infeasible").length,
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
        "path-sensitive engine with exact rounding semantics: exact-rational affine execution, " +
        "rounded stores tracked as exact forms and inverted at boundaries (including exact half " +
        "points), constraints decided exactly where forms exist, congruence/equality solving on " +
        "PICTURE grids, witness-fixed product linearization, proven-infeasible path detection",
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
      legacy: { label: config.legacy.label ?? null, ...sideRef(config.legacy), sha256: artifactHash(config.legacy, baseDir) },
      modern: { label: config.modern.label ?? null, ...sideRef(config.modern), sha256: artifactHash(config.modern, baseDir) },
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
      `paths covered: ${report.summary.paths.covered}/${paths.length - report.summary.paths.infeasible}` +
      (report.summary.paths.infeasible > 0 ? ` (+${report.summary.paths.infeasible} proven infeasible)` : "") +
      `; ` +
      `witnesses: ${report.summary.witnesses.realized}/${witnesses.length})`,
  );
  console.log(`  report: ${outPath}`);
  return verdict === "PASS" ? 0 : 1;
}

/**
 * Solve a boundary target for a decision value of the form
 * A0 + k·round_mode,scale(inner) with constant A0 and affine inner:
 * invert the rounding exactly — round(y) = v ⟺ y ∈ [v−½ulp, v+½ulp) for
 * half-up (y ∈ [v, v+ulp) for truncation) — and drive `inner` to a point
 * of that interval, including the exact half endpoint where HALF_UP and
 * HALF_EVEN part ways. `offset` selects boundary−1/boundary/boundary+1 in
 * units of one representable step of the decision value.
 */
function solveThroughRounding(
  exact: ExactForm,
  offset: bigint,
  inputs: InputVar[],
  fixedCandidates: Assignment[],
  constraints: Constraint[],
): Assignment | null {
  const rt = exact.rounds[0]!;
  if (rIsZero(rt.coeff)) return null;
  const u = ulpOf(rt.scale);
  const step = rMul(rAbs(rt.coeff), u); // one representable move of the decision value
  const t = rMul(step, { n: offset, d: 1n });
  const v = rDiv(rSub(t, exact.affine.c), rt.coeff); // required round(inner)
  if (rCmp(v, R0) < 0) return null; // unsigned PICTURE domains only
  if (ratToDecimal(v, rt.scale) === null) return null; // off the rounding grid
  const half = rDiv(u, { n: 2n, d: 1n });
  const innerTargets =
    rt.mode === "half-up"
      ? [rSub(v, half), v, rAdd(v, rDiv(u, { n: 4n, d: 1n }))]
      : [v, rAdd(v, half)];
  for (const tA of innerTargets) {
    if (rCmp(tA, R0) < 0) continue;
    const solved = solveEquality(rt.inner, tA, inputs, fixedCandidates, constraints);
    if (solved) return solved;
  }
  return null;
}

/**
 * Linearize a nonlinear ROUNDED expression of the shape
 * f1 * f2 * ... [/ literal] by fixing every factor except one at the
 * path's witness assignment (an in-path point by construction), leaving a
 * single-variable affine the congruence solver can use.
 */
function linearizeProduct(
  cmp: ComputeStmt,
  env: Map<string, SymVal>,
  inputs: InputVar[],
  fixed: Assignment,
  items: DataItem[],
  assigned: Set<string>,
): { a: Affine; fixed: Assignment; desc: string } | null {
  if (fixed.some((v, i) => inputs[i]!.numeric && v === null)) return null;
  const toks = cmp.expression.text.split(/\s+/).map((t) => t.replace(/^\(+/, "").replace(/\)+$/, ""));
  // Expect: operand (* operand)* [/ literal]
  const factors: string[] = [];
  let divisor: Rat | null = null;
  for (let i = 0; i < toks.length; i++) {
    if (i % 2 === 0) {
      factors.push(toks[i]!);
    } else if (toks[i] === "*") {
      continue;
    } else if (toks[i] === "/" && i === toks.length - 2) {
      // trailing "/ literal": the dividend factor is already in the list
      divisor = ratOf(toks[i + 1]!);
      if (!divisor || rIsZero(divisor)) return null;
      break;
    } else {
      return null;
    }
  }
  if (factors.length < 2) return null;
  // Value of each factor on this path: env affine (drift-free) or constant.
  const factorAffine = (name: string): Affine | null => {
    const v = env.get(name);
    if (v?.kind === "affine" && rIsZero(v.a.fuzz)) return v.a;
    if (v) return null;
    const item = findItem(items, name);
    const k = item ? constantRat(item, assigned) : null;
    if (k) return affineConst(k);
    const lit = ratOf(name);
    return lit ? affineConst(lit) : null;
  };
  for (let free = 0; free < factors.length; free++) {
    const freeAffine = factorAffine(factors[free]!);
    if (!freeAffine || freeAffine.terms.size === 0) continue;
    let k: Rat = divisor ? rDiv({ n: 1n, d: 1n }, divisor) : { n: 1n, d: 1n };
    let ok = true;
    const fixedNames: string[] = [];
    for (let j = 0; j < factors.length; j++) {
      if (j === free) continue;
      const fa = factorAffine(factors[j]!);
      if (!fa) {
        ok = false;
        break;
      }
      const val = evalAffine(fa, fixed);
      if (rIsZero(val)) {
        ok = false; // a zero factor makes the product constant
        break;
      }
      k = rMul(k, val);
      fixedNames.push(`${factors[j]} = ${ratToDecimal(val, 6) ?? "?"}`);
    }
    if (!ok) continue;
    return {
      a: affineScale(freeAffine, k),
      fixed,
      desc: `${factors[free]} free, ${fixedNames.join(", ")}`,
    };
  }
  return null;
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
