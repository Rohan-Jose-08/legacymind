/**
 * Layer A — property-based testing.
 *
 * Generates input cases from the COBOL data division: each stdin line is
 * mapped to a data item, and its PICTURE clause defines the value domain
 * (digits and scale for numerics, length for alphanumerics). Cases are
 * drawn from a seeded deterministic PRNG — the same seed always produces
 * the same cases, so a certification run is reproducible.
 *
 * Every generated case is executed through both systems via the shared
 * diff-exec machinery. Failures are shrunk to a smaller counterexample by
 * greedily simplifying numeric inputs while the divergence persists.
 *
 * This is deliberately independent of layer B's curated cases: layer B
 * proves behavior on known-important traces; layer A hunts for divergence
 * in the input space nobody thought to write a case for.
 *
 * The generator core (resolveGenerator / generateCases) is exported so
 * `migrate` can use layer A as a second candidate-selection gate.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DataItem, ModuleIR } from "../parse/parser.js";
import {
  DiffExecError,
  loadConfig,
  runCase,
  artifactHash,
  sideLabel,
  sideRef,
  type DiffCase,
  type DiffConfig,
  type FieldDiff,
} from "./diffexec.js";

export function findItem(items: DataItem[], name: string): DataItem | null {
  for (const item of items) {
    if (item.name === name) return item;
    const hit = findItem(item.children ?? [], name);
    if (hit) return hit;
  }
  return null;
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fmt = (n: number, scale: number): string => n.toFixed(scale);

function genValue(field: DataItem, rng: () => number): string {
  const t = field.type;
  if (!t) throw new DiffExecError(`generator: field ${field.name} has no PICTURE type in the IR`);
  if (t.category === "alphanumeric") {
    const len = t.length ?? 6;
    let s = String.fromCharCode(65 + Math.floor(rng() * 26));
    while (s.length < len) s += String(Math.floor(rng() * 10));
    return s;
  }
  const digits = t.digits ?? 5;
  const scale = t.scale ?? 0;
  const max = 10 ** digits - 1;
  // ~20% boundary bias: zero, max, and small values are where legacy
  // arithmetic edge cases (truncation, rounding, overflow) live.
  const roll = rng();
  let n: number;
  if (roll < 0.05) n = 0;
  else if (roll < 0.1) n = max;
  else if (roll < 0.2) n = Math.floor(rng() * 1000);
  else n = Math.floor(rng() * (max + 1));
  return fmt(n / 10 ** scale, scale);
}

export interface ResolvedRecords {
  domain: DataItem;
  min: number;
  max: number;
}

export interface ResolvedGenerator {
  ir: ModuleIR;
  irPath: string;
  fields: DataItem[];
  /** Record-stream mode (docs/record-protocol.md): variable-length cases of file records. */
  records: ResolvedRecords | null;
  count: number;
  seed: number;
}

export function resolveGenerator(
  config: DiffConfig,
  baseDir: string,
  overrides: { count?: number; seed?: number },
): ResolvedGenerator {
  const gen = config.generator;
  if (!gen) throw new DiffExecError('layer A needs a "generator" block in the config (ir, stdinFields or records)');
  if (!!gen.records === !!gen.stdinFields) {
    throw new DiffExecError('layer A: the generator needs exactly one of "stdinFields" or "records"');
  }
  const irPath = resolve(baseDir, gen.ir);
  const ir = JSON.parse(readFileSync(irPath, "utf8")) as ModuleIR;
  let fields: DataItem[] = [];
  let records: ResolvedRecords | null = null;
  if (gen.records) {
    const domain = findItem(ir.dataDivision.items, gen.records.domain);
    if (!domain) throw new DiffExecError(`generator: records.domain ${gen.records.domain} not found in ${gen.ir}`);
    records = { domain, min: gen.records.min ?? 0, max: gen.records.max };
  } else {
    fields = gen.stdinFields!.map((name) => {
      const item = findItem(ir.dataDivision.items, name);
      if (!item) throw new DiffExecError(`generator: field ${name} not found in the data division of ${gen.ir}`);
      return item;
    });
  }
  return {
    ir,
    irPath,
    fields,
    records,
    count: overrides.count ?? gen.count ?? 200,
    seed: overrides.seed ?? gen.seed ?? 1,
  };
}

export function generateCases(
  fields: DataItem[],
  count: number,
  seed: number,
  records: ResolvedRecords | null = null,
): DiffCase[] {
  const rng = mulberry32(seed);
  const cases: DiffCase[] = [];
  for (let i = 0; i < count; i++) {
    let stdin: string[];
    if (records) {
      // Record counts bias toward the edges where batch translations break:
      // the empty file, the single record, and the configured maximum.
      const roll = rng();
      const span = records.max - records.min;
      let n: number;
      if (roll < 0.08) n = records.min;
      else if (roll < 0.16) n = Math.min(records.min + 1, records.max);
      else if (roll < 0.24) n = records.max;
      else n = records.min + Math.floor(rng() * (span + 1));
      stdin = Array.from({ length: n }, () => genValue(records.domain, rng));
    } else {
      stdin = fields.map((f) => genValue(f, rng));
    }
    cases.push({ id: `gen-${String(i).padStart(4, "0")}`, stdin });
  }
  return cases;
}

/** Simplification candidates for one numeric value, most aggressive first. */
function simplify(value: string, scale: number): string[] {
  const v = Number.parseFloat(value);
  if (!Number.isFinite(v) || v === 0) return [];
  const out: string[] = [];
  for (const c of [0, 1, Math.floor(v), v / 10, v / 2]) {
    const s = fmt(c, scale);
    const cv = Number.parseFloat(s);
    if (cv < v && !out.includes(s) && s !== value) out.push(s);
  }
  return out;
}

export function runPropGen(
  configPath: string,
  outPath: string,
  overrides: { count?: number; seed?: number },
): number {
  const config = loadConfig(configPath);
  const baseDir = dirname(resolve(configPath));
  const { ir: _ir, irPath, fields, records, count, seed } = resolveGenerator(config, baseDir, overrides);
  const gen = config.generator!;

  const numericIdx = fields
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.type?.category === "numeric")
    .map(({ i }) => i);

  console.log(`legacymind verify (layer A: property-based, seed=${seed}, count=${count})`);
  console.log(`  legacy: ${sideLabel(config.legacy)}`);
  console.log(`  modern: ${sideLabel(config.modern)}`);
  console.log(
    records
      ? `  domain: record stream of ${records.domain.name} PIC ${records.domain.type?.category}, ${records.min}..${records.max} records/case`
      : `  domain: ${fields.map((f) => `${f.name} PIC ${f.type?.category}`).join(", ")}`,
  );
  console.log("");

  // --- generate + execute -----------------------------------------------------
  const results = [];
  for (const cs of generateCases(fields, count, seed, records)) {
    const r = runCase(config, baseDir, cs);
    results.push(r);
    if (r.status !== "PASS") {
      console.log(`  ${r.status.padEnd(5)} ${r.id} stdin=[${cs.stdin.join(", ")}]`);
      for (const d of r.diffs) {
        console.log(`        ${d.field}: legacy=${d.legacy} modern=${d.modern}`);
      }
      for (const n of r.notes) console.log(`        note: ${n}`);
    }
  }

  // --- shrink failures ----------------------------------------------------------
  const MAX_SHRINK_TARGETS = 5;
  const MAX_SHRINK_RUNS = 30;
  const failures = results.filter((r) => r.status === "FAIL");

  const failsWith = (stdin: string[]): { fails: boolean; diffs: FieldDiff[] } => {
    const r = runCase(config, baseDir, { id: "shrink-probe", stdin });
    return { fails: r.status === "FAIL", diffs: r.diffs };
  };

  const shrunk = new Map<string, { stdin: string[]; diffs: FieldDiff[]; runs: number }>();
  for (const failure of failures.slice(0, MAX_SHRINK_TARGETS)) {
    let current = [...failure.stdin];
    let currentDiffs = failure.diffs;
    let runs = 0;
    let changed = true;
    while (changed && runs < MAX_SHRINK_RUNS) {
      changed = false;
      // Records mode: the most valuable simplification is DROPPING a record
      // (fewer lines is a strictly smaller counterexample).
      if (records) {
        for (let drop = 0; drop < current.length && runs < MAX_SHRINK_RUNS; drop++) {
          const trial = current.filter((_, i) => i !== drop);
          if (trial.length < records.min) continue;
          runs++;
          const probe = failsWith(trial);
          if (probe.fails) {
            current = trial;
            currentDiffs = probe.diffs;
            changed = true;
            break;
          }
        }
        if (changed) continue;
      }
      const idxs = records ? current.map((_, i) => i) : numericIdx;
      for (const idx of idxs) {
        const scale = records ? records.domain.type?.scale ?? 0 : fields[idx]!.type?.scale ?? 0;
        for (const candidate of simplify(current[idx]!, scale)) {
          if (runs >= MAX_SHRINK_RUNS) break;
          const trial = [...current];
          trial[idx] = candidate;
          runs++;
          const probe = failsWith(trial);
          if (probe.fails) {
            current = trial;
            currentDiffs = probe.diffs;
            changed = true;
            break; // restart this field from its new, smaller value
          }
        }
      }
    }
    shrunk.set(failure.id, { stdin: current, diffs: currentDiffs, runs });
    console.log(`  shrunk ${failure.id}: [${failure.stdin.join(", ")}] -> [${current.join(", ")}] (${runs} runs)`);
  }

  // --- report ---------------------------------------------------------------------
  const summary = {
    generated: results.length,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: failures.length,
    errored: results.filter((r) => r.status === "ERROR").length,
  };
  const verdict: "PASS" | "FAIL" = summary.passed === summary.generated ? "PASS" : "FAIL";

  const report = {
    tool: "legacymind property-gen (verifier layer A)",
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    verdict,
    summary,
    generator: {
      ir: gen.ir,
      irSha256: createHash("sha256").update(readFileSync(irPath)).digest("hex"),
      stdinFields: gen.stdinFields ?? null,
      records: gen.records ?? null,
      seed,
      count,
      note: "deterministic: identical seed + count + IR reproduce identical cases",
    },
    config: {
      path: resolve(configPath).replace(/\\/g, "/"),
      sha256: createHash("sha256").update(readFileSync(configPath)).digest("hex"),
      numericTolerance: config.numericTolerance ?? 0,
    },
    artifacts: {
      legacy: { label: config.legacy.label ?? null, ...sideRef(config.legacy), sha256: artifactHash(config.legacy, baseDir) },
      modern: { label: config.modern.label ?? null, ...sideRef(config.modern), sha256: artifactHash(config.modern, baseDir) },
    },
    failures: results
      .filter((r) => r.status !== "PASS")
      .map((r) => ({
        id: r.id,
        status: r.status,
        stdin: r.stdin,
        diffs: r.diffs,
        notes: r.notes,
        raw: r.raw,
        shrunk: shrunk.get(r.id) ?? null,
      })),
  };

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log("");
  console.log(
    `  verdict: ${verdict}  (${summary.passed}/${summary.generated} passed, ${summary.failed} failed, ${summary.errored} errored)`,
  );
  console.log(`  report: ${outPath}`);
  return verdict === "PASS" ? 0 : 1;
}
