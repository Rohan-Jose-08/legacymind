/**
 * Layer D — static data-flow equivalence.
 *
 * Compares, without executing anything, the derivation of every KEY=VALUE
 * output between the legacy module (from its IR) and the migrated Java
 * (from verifier/javaflow/JavaFlow.java, the javac-Tree-API extractor).
 * The comparison is name-independent: both sides read stdin in a fixed
 * order and print named keys, so each key's derivation is expressed over
 * canonical input positions plus constants — no fuzzy identifier matching.
 *
 * Compared per output key (mismatch = DIVERGENT, verdict FAIL):
 *   inputs      set of stdin positions the value derives from
 *   constants   multiplicative numeric constants (powers of ten excluded —
 *               they surface as shifts or capacities instead)
 *   rounding    the SET of rounding modes used (half-up / half-even).
 *               Occurrence counts are deliberately not compared: the
 *               extraction unions branches (flow-insensitive), so a
 *               rounding duplicated per COBOL branch but hoisted after a
 *               Java ternary would false-positive on counts. Truncation is
 *               not compared either — frequently a numeric no-op, covered
 *               dynamically. Double-rounding detection needs the planned
 *               path-sensitive engine.
 *   shifts      the SET of decimal-point shifts (COBOL /100 vs Java
 *               movePointLeft(2)) — sets for the same branch-union reason
 *
 * Capacity (storage modulus) differences are reported as WARNINGS, not
 * failures: statically a missing store-capacity may be unreachable — the
 * dynamic layers decide. Anything either extractor could not analyze makes
 * the key UNRESOLVED, disclosed in the report and the certificate.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DataItem, ModuleIR, Statement } from "../parse/parser.js";
import { DiffExecError } from "./diffexec.js";
import { inlineStatements, rangeNames, rangeStatements, topLevelChain } from "./symexec.js";
import { findItem } from "./propgen.js";

export interface StaticConfig {
  /** Path to the legacy module's IR (relative to the config file). */
  ir: string;
  /** Path to the migrated Java source (relative to the config file). */
  modernJava: string;
}

interface FlowRec {
  sources: Set<string>;
  inputs: Set<number>;
  constants: Set<string>;
  rounding: string[];
  shifts: number[];
  capacities: Set<string>;
  unresolved: string[];
}

interface ResolvedFlow {
  inputs: number[];
  constants: string[];
  rounding: string[];
  shifts: number[];
  capacities: string[];
  unresolved: string[];
}

const newFlow = (): FlowRec => ({
  sources: new Set(),
  inputs: new Set(),
  constants: new Set(),
  rounding: [],
  shifts: [],
  capacities: new Set(),
  unresolved: [],
});

const canon = (n: number): string => {
  const s = n.toString();
  return s.includes("e") ? n.toFixed(20).replace(/0+$/, "").replace(/\.$/, "") : s;
};

const isPowerOfTen = (v: number): boolean => {
  if (v < 10) return false;
  const log = Math.log10(v);
  return Number.isInteger(log) && 10 ** Math.round(log) === v;
};

// --- legacy side: flows from the IR --------------------------------------------

function collectAssigned(stmts: Statement[], out: Set<string>): void {
  for (const s of stmts) {
    if (s.kind === "move") for (const t of s.to) out.add(t);
    else if (s.kind === "compute") out.add(s.target);
    else if (s.kind === "accept") out.add(s.target);
    else if (s.kind === "perform-varying") out.add(s.varying.var);
    else if (s.kind === "read") {
      out.add(s.record);
      collectAssigned(s.atEnd, out);
      collectAssigned(s.notAtEnd, out);
    } else if (s.kind === "if") {
      collectAssigned(s.then, out);
      collectAssigned(s.else ?? [], out);
    }
  }
}

export function extractLegacyFlows(ir: ModuleIR): { outputs: Map<string, FlowRec>; varFlows: Map<string, FlowRec> } {
  const items = ir.dataDivision.items;
  const assigned = new Set<string>();
  for (const p of ir.procedureDivision.paragraphs) collectAssigned(p.statements, assigned);

  const constantValue = (name: string): number | null => {
    const item = findItem(items, name);
    if (!item?.value || assigned.has(item.name)) return null;
    const num = Number(item.value);
    return Number.isFinite(num) ? num : null;
  };

  const capacityOf = (name: string): string | null => {
    const item = findItem(items, name);
    const t = item?.type;
    if (!t || t.category === "alphanumeric" || t.digits === undefined) return null;
    return canon(10 ** (t.digits - (t.scale ?? 0)));
  };

  const varFlows = new Map<string, FlowRec>();
  const outputs = new Map<string, FlowRec>();
  const merged = (name: string): FlowRec => {
    let f = varFlows.get(name);
    if (!f) {
      f = newFlow();
      varFlows.set(name, f);
    }
    return f;
  };

  const exprFlow = (text: string, refs: string[]): FlowRec => {
    const flow = newFlow();
    for (const ref of refs) {
      const cv = constantValue(ref);
      if (cv !== null) flow.constants.add(canon(cv));
      else flow.sources.add(ref);
    }
    // numeric literals + division-by-power-of-ten shifts from the raw text
    const toks = text.split(/\s+/).map((t) => t.replace(/^\(+/, "").replace(/\)+$/, ""));
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i]!;
      if (!/^(\d+(\.\d+)?|\.\d+)$/.test(t)) continue;
      const v = Number(t);
      if (i > 0 && toks[i - 1] === "/" && isPowerOfTen(v)) flow.shifts.push(Math.round(Math.log10(v)));
      else flow.constants.add(canon(v));
    }
    return flow;
  };

  const paras = new Map(ir.procedureDivision.paragraphs.map((p) => [p.name, p]));

  let stdinCounter = 0;
  const walk = (stmts: Statement[]): void => {
    for (const s of stmts) {
      if (s.kind === "accept") {
        merged(s.target).inputs.add(stdinCounter++);
      } else if (s.kind === "read") {
        // The record area is written from the input stream: one logical
        // input position, unioned over all iterations (flow-insensitive) —
        // symmetric with the modern side's single in-loop read.
        merged(s.record).inputs.add(stdinCounter++);
        walk(s.atEnd);
        walk(s.notAtEnd);
      } else if (s.kind === "compute") {
        const flow = merged(s.target);
        const e = exprFlow(s.expression.text, s.expression.refs);
        flow.sources = new Set([...flow.sources, ...e.sources]);
        for (const c of e.constants) flow.constants.add(c);
        flow.shifts.push(...e.shifts);
        if (s.rounded) flow.rounding.push("half-up"); // COBOL ROUNDED: half away from zero
        const cap = capacityOf(s.target);
        if (cap) flow.capacities.add(cap);
      } else if (s.kind === "move") {
        const e = exprFlow(s.from.text, s.from.refs);
        for (const target of s.to) {
          const flow = merged(target);
          flow.sources = new Set([...flow.sources, ...e.sources]);
          for (const c of e.constants) flow.constants.add(c);
          const cap = capacityOf(target);
          if (cap) flow.capacities.add(cap);
        }
      } else if (s.kind === "if") {
        // flow-insensitive union, mirroring the Java-side extractor
        walk(s.then);
        walk(s.else ?? []);
      } else if (s.kind === "perform-times" || s.kind === "perform-until" || s.kind === "perform-varying") {
        // Loop body contributes its flows once (union) — counts are never
        // compared, so iteration count is irrelevant to this layer, and
        // this mirrors the Java-side extractor's treatment of loops.
        if (s.kind === "perform-varying") {
          const flow = merged(s.varying.var);
          for (const operand of [s.varying.from, s.varying.by]) {
            const e = exprFlow(operand.text, operand.refs);
            flow.sources = new Set([...flow.sources, ...e.sources]);
            for (const c of e.constants) flow.constants.add(c);
            flow.shifts.push(...e.shifts);
          }
        }
        const names = rangeNames(s.target, s.thru, paras);
        walk(inlineStatements(rangeStatements(names, paras), paras, names));
      } else if (s.kind === "display") {
        let pendingKey: string | null = null;
        for (const op of s.operands) {
          if (op.kind === "literal") {
            const m = /([A-Z][A-Z0-9_]*)=\s*$/.exec(op.value);
            pendingKey = m ? m[1]! : null;
          } else if (pendingKey) {
            const flow = outputs.get(pendingKey) ?? newFlow();
            flow.sources.add(op.name);
            outputs.set(pendingKey, flow);
            pendingKey = null;
          }
        }
      }
    }
  };

  if (!paras.has(ir.controlFlow.entry)) {
    throw new DiffExecError(`layer D: entry paragraph ${ir.controlFlow.entry} not found`);
  }
  // Walk the full top-level fall-through chain (mirrors layer C): outputs
  // printed in fall-through paragraphs belong to the legacy flow union too.
  walk(inlineStatements(topLevelChain(paras, ir.controlFlow.entry), paras, [ir.controlFlow.entry]));
  return { outputs, varFlows };
}

function resolveFlow(flow: FlowRec, varFlows: Map<string, FlowRec>, visited: Set<string>): ResolvedFlow {
  const out: ResolvedFlow = {
    inputs: [...flow.inputs],
    constants: [...flow.constants],
    rounding: [...flow.rounding],
    shifts: [...flow.shifts],
    capacities: [...flow.capacities],
    unresolved: [...flow.unresolved],
  };
  for (const src of flow.sources) {
    if (visited.has(src)) continue;
    visited.add(src);
    const def = varFlows.get(src);
    if (!def) {
      out.unresolved.push(`source has no definition: ${src}`);
      continue;
    }
    const r = resolveFlow(def, varFlows, visited);
    out.inputs.push(...r.inputs);
    out.constants.push(...r.constants);
    out.rounding.push(...r.rounding);
    out.shifts.push(...r.shifts);
    out.capacities.push(...r.capacities);
    out.unresolved.push(...r.unresolved);
  }
  out.inputs = [...new Set(out.inputs)].sort((a, b) => a - b);
  out.constants = [...new Set(out.constants)].sort();
  out.capacities = [...new Set(out.capacities)].sort();
  out.shifts.sort((a, b) => a - b);
  return out;
}

// --- modern side: run the javac-based extractor -----------------------------------

function repoRoot(): string {
  // dist/verify/staticflow.js -> cli/dist/verify -> repo root is three up
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function runJavaFlow(javaFile: string): Record<string, ResolvedFlow> {
  const toolDir = join(repoRoot(), "verifier", "javaflow");
  const source = join(toolDir, "JavaFlow.java");
  const clazz = join(toolDir, "JavaFlow.class");
  if (!existsSync(source)) throw new DiffExecError(`layer D: extractor source not found at ${source}`);
  if (!existsSync(clazz) || statSync(clazz).mtimeMs < statSync(source).mtimeMs) {
    const javac = spawnSync("javac", ["--release", "21", source], { encoding: "utf8", windowsHide: true });
    if (javac.status !== 0) throw new DiffExecError(`layer D: javac failed:\n${javac.stderr}`);
  }
  const run = spawnSync("java", ["-cp", toolDir, "JavaFlow", javaFile], { encoding: "utf8", windowsHide: true });
  if (run.status !== 0 || run.error) {
    throw new DiffExecError(`layer D: JavaFlow failed on ${javaFile}:\n${run.stderr}${run.error ?? ""}`);
  }
  const parsed = JSON.parse(run.stdout) as { outputs: Record<string, ResolvedFlow> };
  for (const flow of Object.values(parsed.outputs)) {
    flow.inputs = [...new Set(flow.inputs)].sort((a, b) => a - b);
    flow.constants = [...new Set(flow.constants.map((c) => canon(Number(c))))].sort();
    flow.capacities = [...new Set(flow.capacities.map((c) => canon(Number(c))))].sort();
    flow.shifts.sort((a, b) => a - b);
  }
  return parsed.outputs;
}

// --- comparison ----------------------------------------------------------------------

type KeyStatus = "VERIFIED" | "DIVERGENT" | "UNRESOLVED";

interface KeyResult {
  key: string;
  status: KeyStatus;
  mismatches: string[];
  warnings: string[];
  legacy: ResolvedFlow | null;
  modern: ResolvedFlow | null;
}

const stripPowersOfTen = (constants: string[]): string[] =>
  constants.filter((c) => !isPowerOfTen(Number(c)));

const modeSet = (rounding: string[]): string => [...new Set(rounding)].sort().join(",") || "none";
const shiftSet = (shifts: number[]): string => [...new Set(shifts)].sort((a, b) => a - b).join(",");

function compareKey(key: string, legacy: ResolvedFlow | null, modern: ResolvedFlow | null): KeyResult {
  const result: KeyResult = { key, status: "VERIFIED", mismatches: [], warnings: [], legacy, modern };
  if (!legacy || !modern) {
    result.status = "DIVERGENT";
    result.mismatches.push(`output key present only in ${legacy ? "legacy" : "modern"} side`);
    return result;
  }
  if (JSON.stringify(legacy.inputs) !== JSON.stringify(modern.inputs)) {
    result.mismatches.push(`inputs differ: legacy [${legacy.inputs}] vs modern [${modern.inputs}]`);
  }
  const lc = stripPowersOfTen(legacy.constants);
  const mc = stripPowersOfTen(modern.constants);
  if (JSON.stringify(lc) !== JSON.stringify(mc)) {
    result.mismatches.push(`constants differ: legacy [${lc}] vs modern [${mc}]`);
  }
  if (modeSet(legacy.rounding) !== modeSet(modern.rounding)) {
    result.mismatches.push(
      `rounding modes differ: legacy {${modeSet(legacy.rounding)}} vs modern {${modeSet(modern.rounding)}}`,
    );
  }
  if (shiftSet(legacy.shifts) !== shiftSet(modern.shifts)) {
    result.mismatches.push(
      `decimal shifts differ: legacy {${shiftSet(legacy.shifts)}} vs modern {${shiftSet(modern.shifts)}}`,
    );
  }
  if (JSON.stringify(legacy.capacities) !== JSON.stringify(modern.capacities)) {
    result.warnings.push(
      `storage capacities differ: legacy {${legacy.capacities}} vs modern {${modern.capacities}} — ` +
        `statically inconclusive; covered dynamically by layers A/B/C`,
    );
  }
  if (result.mismatches.length > 0) result.status = "DIVERGENT";
  else if (legacy.unresolved.length > 0 || modern.unresolved.length > 0) result.status = "UNRESOLVED";
  return result;
}

// --- entry point -------------------------------------------------------------------------

export function runStaticFlow(configPath: string, outPath: string): number {
  let config: { static?: StaticConfig };
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    throw new DiffExecError(`cannot read config ${configPath}: ${(e as Error).message}`);
  }
  const st = config.static;
  if (!st?.ir || !st.modernJava) {
    throw new DiffExecError('layer D needs a "static" block in the config (ir, modernJava)');
  }
  const baseDir = dirname(resolve(configPath));
  const irPath = resolve(baseDir, st.ir);
  const javaPath = resolve(baseDir, st.modernJava);
  const ir = JSON.parse(readFileSync(irPath, "utf8")) as ModuleIR;

  console.log(`legacymind verify (layer D: static data-flow equivalence)`);
  console.log(`  legacy: ${st.ir} (IR of ${ir.module.programId})`);
  console.log(`  modern: ${st.modernJava}`);
  console.log("");

  const { outputs: legacyOutputs, varFlows } = extractLegacyFlows(ir);
  const legacyResolved = new Map<string, ResolvedFlow>();
  for (const [key, flow] of legacyOutputs) legacyResolved.set(key, resolveFlow(flow, varFlows, new Set()));
  const modernOutputs = runJavaFlow(javaPath);

  const keys = [...new Set([...legacyResolved.keys(), ...Object.keys(modernOutputs)])].sort();
  const results = keys.map((key) => compareKey(key, legacyResolved.get(key) ?? null, modernOutputs[key] ?? null));

  for (const r of results) {
    console.log(`  ${r.status.padEnd(10)} ${r.key}`);
    for (const m of r.mismatches) console.log(`        ${m}`);
    for (const w of r.warnings) console.log(`        warning: ${w}`);
    if (r.status === "UNRESOLVED") {
      for (const u of [...(r.legacy?.unresolved ?? []), ...(r.modern?.unresolved ?? [])]) {
        console.log(`        unresolved: ${u}`);
      }
    }
  }

  const summary = {
    keys: {
      total: results.length,
      verified: results.filter((r) => r.status === "VERIFIED").length,
      divergent: results.filter((r) => r.status === "DIVERGENT").length,
      unresolved: results.filter((r) => r.status === "UNRESOLVED").length,
    },
    capacityWarnings: results.reduce((n, r) => n + r.warnings.length, 0),
  };
  const verdict: "PASS" | "FAIL" = summary.keys.divergent === 0 ? "PASS" : "FAIL";

  const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const report = {
    tool: "legacymind staticflow (verifier layer D)",
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    verdict,
    summary,
    comparison: {
      facets: [
        "input positions (set)",
        "constants (set, powers of ten excluded)",
        "rounding modes (set — counts are branch-union-dependent and not compared)",
        "decimal shifts (set)",
      ],
      warningsOnly: ["storage capacities"],
      note: "static, flow-insensitive, name-independent (keys + stdin positions); truncation not compared",
    },
    keys: results,
    config: { path: resolve(configPath).replace(/\\/g, "/"), sha256: sha(configPath) },
    artifacts: {
      legacy: { label: `IR ${st.ir}`, sha256: sha(irPath) },
      modern: { label: st.modernJava.replace(/\\/g, "/"), sha256: sha(javaPath) },
      extractor: { label: "verifier/javaflow/JavaFlow.java", sha256: sha(join(repoRoot(), "verifier", "javaflow", "JavaFlow.java")) },
    },
  };
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log("");
  console.log(
    `  verdict: ${verdict}  (${summary.keys.verified}/${summary.keys.total} keys verified, ` +
      `${summary.keys.divergent} divergent, ${summary.keys.unresolved} unresolved, ` +
      `${summary.capacityWarnings} capacity warning(s))`,
  );
  console.log(`  report: ${outPath}`);
  return verdict === "PASS" ? 0 : 1;
}
