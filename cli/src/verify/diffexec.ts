/**
 * Layer B — differential execution (plus the shared execution/compare
 * machinery reused by layer A and by candidate selection in `migrate`).
 *
 * Runs the legacy executable and the modernized executable against the
 * same list of input cases, diffs their outputs field-by-field, and
 * writes a machine-readable report. Any divergence beyond the configured
 * numeric tolerance is a FAIL with the full counterexample preserved.
 * Any crash, timeout, or nonzero exit is an ERROR. The overall verdict
 * is PASS only when every case passes — no hidden failures.
 *
 * Execution contract (protocol "stdin-lines" / "kv-lines"):
 *   - input: the case's stdin lines, newline-joined, piped to stdin
 *   - output: one FIELD=VALUE pair per stdout line; anything else is
 *     recorded as an unparsed line and surfaced in the report
 *
 * The harness is deliberately command-agnostic: "legacy" can be a
 * cobc-compiled binary, "modern" a `java -cp … Main` invocation, or (as
 * in the bundled demo) mock scripts. Sandboxing (Docker, no network,
 * ephemeral fs, injected clock) belongs to harness/ and is NOT provided
 * here yet — see verifier/README.md for the roadmap.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export class DiffExecError extends Error {}

export interface SideConfig {
  argv: string[];
  label?: string;
  /** Extra environment variables merged over the parent environment. */
  env?: Record<string, string>;
}

export interface GeneratorConfig {
  /** Path to the module's IR (relative to the config file). */
  ir: string;
  /** Data-division item names, one per stdin line, defining the input domain. */
  stdinFields: string[];
  count?: number;
  seed?: number;
}

export interface DiffCase {
  id: string;
  stdin: string[];
}

export interface SymbolicConfig {
  /** Path to the module's IR (relative to the config file). */
  ir: string;
  /** Data-division item names, one per stdin line, defining the input domain. */
  stdinFields: string[];
  /** A known-good input assignment; boundary cases mutate it one field at a time. */
  baseCase: string[];
  /** Regex marking money-touching fields (default covers IBM copybook conventions). */
  moneyPattern?: string;
  /** Explicit money-touching field names (union with the pattern). */
  annotations?: string[];
  /** Max solutions to derive per rounding-boundary congruence. Default 5. */
  maxBoundarySolutions?: number;
  /**
   * Max PERFORM-loop iterations to unroll per loop (default 12). Input
   * regions needing more iterations are surfaced as unknown-coverage
   * paths, never silently dropped.
   */
  maxLoopUnroll?: number;
}

export interface DiffConfig {
  legacy: SideConfig;
  modern: SideConfig;
  protocol?: { input: "stdin-lines"; output: "kv-lines" };
  /** Absolute tolerance for numeric fields. Default 0 — exact or fail. */
  numericTolerance?: number;
  timeoutMs?: number;
  /** Curated cases (layer B). May be empty when a generator is used (layer A). */
  cases?: DiffCase[];
  /** Property-based generation settings (layer A). */
  generator?: GeneratorConfig;
  /** Symbolic-execution settings (layer C). */
  symbolic?: SymbolicConfig;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

export interface FieldDiff {
  field: string;
  kind: "numeric-divergence" | "string-divergence" | "missing-in-legacy" | "missing-in-modern";
  legacy?: string;
  modern?: string;
  absDelta?: number;
  tolerance?: number;
}

export interface CaseResult {
  id: string;
  status: "PASS" | "FAIL" | "ERROR";
  stdin: string[];
  comparedFields: number;
  diffs: FieldDiff[];
  notes: string[];
  legacy: { exitCode: number | null; durationMs: number };
  modern: { exitCode: number | null; durationMs: number };
  /** Raw outputs are preserved only for non-passing cases to keep reports lean. */
  raw?: {
    legacyStdout: string;
    legacyStderr: string;
    modernStdout: string;
    modernStderr: string;
  };
}

export interface DiffSummary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
}

const NUMERIC_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function loadConfig(configPath: string): DiffConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (e) {
    throw new DiffExecError(`cannot read config ${configPath}: ${(e as Error).message}`);
  }
  const c = parsed as DiffConfig;
  for (const side of ["legacy", "modern"] as const) {
    const s = c[side];
    if (!s || !Array.isArray(s.argv) || s.argv.length === 0 || s.argv.some((a) => typeof a !== "string")) {
      throw new DiffExecError(`config: "${side}.argv" must be a non-empty array of strings`);
    }
  }
  const cases = c.cases ?? [];
  if (!Array.isArray(cases)) throw new DiffExecError('config: "cases" must be an array');
  const seen = new Set<string>();
  for (const cs of cases) {
    if (typeof cs.id !== "string" || !Array.isArray(cs.stdin)) {
      throw new DiffExecError('config: every case needs a string "id" and a string[] "stdin"');
    }
    if (seen.has(cs.id)) throw new DiffExecError(`config: duplicate case id "${cs.id}"`);
    seen.add(cs.id);
  }
  return c;
}

export function runSide(side: SideConfig, stdinLines: string[], baseDir: string, timeoutMs: number): RunResult {
  const started = Date.now();
  const res = spawnSync(side.argv[0]!, side.argv.slice(1), {
    cwd: baseDir,
    input: stdinLines.join("\n") + "\n",
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, ...(side.env ?? {}) },
    windowsHide: true,
    shell: false,
  });
  return {
    exitCode: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    durationMs: Date.now() - started,
    error: res.error ? String(res.error) : undefined,
  };
}

export function parseKv(stdout: string, sideLabel: string, notes: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const m = /^([A-Za-z0-9_.-]+)=(.*)$/.exec(line);
    if (!m) {
      notes.push(`${sideLabel}: unparsed output line: ${JSON.stringify(line)}`);
      continue;
    }
    if (fields.has(m[1]!)) {
      notes.push(`${sideLabel}: duplicate field "${m[1]}"; last occurrence wins`);
    }
    fields.set(m[1]!, m[2]!);
  }
  return fields;
}

export function compareFields(
  legacy: Map<string, string>,
  modern: Map<string, string>,
  tolerance: number,
): { diffs: FieldDiff[]; compared: number } {
  const diffs: FieldDiff[] = [];
  const keys = [...new Set([...legacy.keys(), ...modern.keys()])].sort();
  for (const key of keys) {
    const l = legacy.get(key);
    const m = modern.get(key);
    if (l === undefined) {
      diffs.push({ field: key, kind: "missing-in-legacy", modern: m });
      continue;
    }
    if (m === undefined) {
      diffs.push({ field: key, kind: "missing-in-modern", legacy: l });
      continue;
    }
    const lt = l.trim();
    const mt = m.trim();
    if (NUMERIC_RE.test(lt) && NUMERIC_RE.test(mt)) {
      // round away binary-float noise; comparisons happen at far coarser scales
      const delta = Number(Math.abs(Number.parseFloat(lt) - Number.parseFloat(mt)).toPrecision(9));
      if (delta > tolerance) {
        diffs.push({ field: key, kind: "numeric-divergence", legacy: lt, modern: mt, absDelta: delta, tolerance });
      }
    } else if (lt !== mt) {
      diffs.push({ field: key, kind: "string-divergence", legacy: lt, modern: mt });
    }
  }
  return { diffs, compared: keys.length };
}

/** Run one case through both sides and diff the outputs. */
export function runCase(
  config: DiffConfig,
  baseDir: string,
  cs: DiffCase,
  keepRawOnPass = false,
): CaseResult {
  const tolerance = config.numericTolerance ?? 0;
  const timeoutMs = config.timeoutMs ?? 30_000;
  const notes: string[] = [];
  const legacyRun = runSide(config.legacy, cs.stdin, baseDir, timeoutMs);
  const modernRun = runSide(config.modern, cs.stdin, baseDir, timeoutMs);

  let status: CaseResult["status"];
  let diffs: FieldDiff[] = [];
  let compared = 0;

  const legacyBad = legacyRun.error !== undefined || legacyRun.exitCode !== 0;
  const modernBad = modernRun.error !== undefined || modernRun.exitCode !== 0;
  if (legacyBad || modernBad) {
    status = "ERROR";
    if (legacyRun.error) notes.push(`legacy: ${legacyRun.error}`);
    if (modernRun.error) notes.push(`modern: ${modernRun.error}`);
    if (!legacyRun.error && legacyRun.exitCode !== 0) notes.push(`legacy: exit code ${legacyRun.exitCode}`);
    if (!modernRun.error && modernRun.exitCode !== 0) notes.push(`modern: exit code ${modernRun.exitCode}`);
  } else {
    const legacyFields = parseKv(legacyRun.stdout, "legacy", notes);
    const modernFields = parseKv(modernRun.stdout, "modern", notes);
    ({ diffs, compared } = compareFields(legacyFields, modernFields, tolerance));
    status = diffs.length === 0 ? "PASS" : "FAIL";
  }

  const result: CaseResult = {
    id: cs.id,
    status,
    stdin: cs.stdin,
    comparedFields: compared,
    diffs,
    notes,
    legacy: { exitCode: legacyRun.exitCode, durationMs: legacyRun.durationMs },
    modern: { exitCode: modernRun.exitCode, durationMs: modernRun.durationMs },
  };
  if (status !== "PASS" || keepRawOnPass) {
    result.raw = {
      legacyStdout: legacyRun.stdout,
      legacyStderr: legacyRun.stderr,
      modernStdout: modernRun.stdout,
      modernStderr: modernRun.stderr,
    };
  }
  return result;
}

export function runDiffCases(
  config: DiffConfig,
  baseDir: string,
  cases: DiffCase[],
): { results: CaseResult[]; summary: DiffSummary; verdict: "PASS" | "FAIL" } {
  const results = cases.map((cs) => runCase(config, baseDir, cs));
  const summary: DiffSummary = {
    total: results.length,
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
    errored: results.filter((r) => r.status === "ERROR").length,
  };
  return { results, summary, verdict: summary.passed === summary.total ? "PASS" : "FAIL" };
}

/** SHA-256 of the first argv entry (after index 0) that resolves to a file — pins mock scripts, jars, binaries. */
export function artifactHash(side: SideConfig, baseDir: string): string | null {
  for (const a of side.argv.slice(1)) {
    const p = isAbsolute(a) ? a : resolve(baseDir, a);
    if (existsSync(p)) {
      try {
        return createHash("sha256").update(readFileSync(p)).digest("hex");
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function printCaseResults(results: CaseResult[]): void {
  for (const r of results) {
    console.log(`  ${r.status.padEnd(5)} ${r.id} (legacy ${r.legacy.durationMs}ms, modern ${r.modern.durationMs}ms)`);
    for (const d of r.diffs) {
      if (d.kind === "numeric-divergence") {
        console.log(
          `        ${d.field}: legacy=${d.legacy} modern=${d.modern} |delta|=${d.absDelta} > tolerance=${d.tolerance}`,
        );
      } else if (d.kind === "string-divergence") {
        console.log(`        ${d.field}: legacy=${JSON.stringify(d.legacy)} modern=${JSON.stringify(d.modern)}`);
      } else {
        console.log(`        ${d.field}: ${d.kind}`);
      }
    }
    for (const n of r.notes) console.log(`        note: ${n}`);
  }
}

export function runDiffExec(configPath: string, outPath: string): number {
  const config = loadConfig(configPath);
  const baseDir = dirname(resolve(configPath));
  const cases = config.cases ?? [];
  if (cases.length === 0) {
    throw new DiffExecError('layer B needs a non-empty "cases" array (for generated cases, use --layer A)');
  }

  const { results, summary, verdict } = runDiffCases(config, baseDir, cases);

  const report = {
    tool: "legacymind diff-exec (verifier layer B)",
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    verdict,
    summary,
    config: {
      path: resolve(configPath).replace(/\\/g, "/"),
      sha256: createHash("sha256").update(readFileSync(configPath)).digest("hex"),
      numericTolerance: config.numericTolerance ?? 0,
      timeoutMs: config.timeoutMs ?? 30_000,
    },
    artifacts: {
      legacy: {
        label: config.legacy.label ?? null,
        argv: config.legacy.argv,
        sha256: artifactHash(config.legacy, baseDir),
      },
      modern: {
        label: config.modern.label ?? null,
        argv: config.modern.argv,
        sha256: artifactHash(config.modern, baseDir),
      },
    },
    cases: results,
  };

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log(`legacymind verify (layer B: differential execution)`);
  console.log(`  legacy: ${config.legacy.label ?? config.legacy.argv.join(" ")}`);
  console.log(`  modern: ${config.modern.label ?? config.modern.argv.join(" ")}`);
  console.log("");
  printCaseResults(results);
  console.log("");
  console.log(
    `  verdict: ${verdict}  (${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.errored} errored)`,
  );
  console.log(`  report: ${outPath}`);

  return verdict === "PASS" ? 0 : 1;
}
