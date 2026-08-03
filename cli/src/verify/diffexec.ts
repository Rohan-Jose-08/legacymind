/**
 * Layer B — differential execution (plus the shared execution/compare
 * machinery reused by layer A and by candidate selection in `migrate`).
 *
 * Runs the legacy executable and the modernized executable against the
 * same list of input cases, diffs their outputs field-by-field, and
 * writes a machine-readable report. Any divergence beyond the configured
 * numeric tolerance is a FAIL with the full counterexample preserved.
 * A crash or timeout is an ERROR, and so is a nonzero exit — UNLESS the
 * module declares `abnormalTermination`, in which case the exit status is
 * a compared observable rather than a precondition (see that field, and
 * docs/external-services.md). The overall verdict is PASS only when every
 * case passes — no hidden failures.
 *
 * Execution contract (protocol "stdin-lines" / "kv-lines"):
 *   - input: the case's stdin lines, newline-joined, piped to stdin
 *   - output: one FIELD=VALUE pair per stdout line; anything else is
 *     recorded as an unparsed line and surfaced in the report
 *
 * The harness is deliberately command-agnostic: "legacy" can be a
 * cobc-compiled binary, "modern" a `java -cp … Main` invocation, or (as
 * in the bundled demo) mock scripts. The legacy side runs in a pinned
 * GnuCOBOL container (no network, ephemeral fs, injected clock). The
 * modern side runs on the host JDK by default; setting LM_JAVA_IMAGE
 * (harness/openjdk) runs it in a pinned OpenJDK container with the same
 * sandbox — no network, ephemeral fs, read-only classpath — so a
 * sandboxed run gives both sides the same provenance.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export class DiffExecError extends Error {}

export interface SideConfig {
  /** One-shot command per case (spawned directly). Optional when `image` is set. */
  argv?: string[];
  /**
   * Persistent-container mode: run the image's own entrypoint via
   * `docker exec` inside one long-lived `--network none` container shared
   * by every case of this process — same binary, same sandbox, without
   * paying container startup (~0.9s) per case. The container starts
   * lazily and is removed when the process exits.
   */
  image?: string;
  label?: string;
  /** Extra environment variables merged over the parent environment. */
  env?: Record<string, string>;
}

/**
 * Record-stream input: the case's stdin lines are the input FILE's
 * records.
 *
 * Stage 2a (single elementary field, docs/record-protocol.md): `domain`
 * names the numeric twin the record's NUMVAL lands in — the PICTURE that
 * defines each record line's value domain.
 *
 * Stage 2b (multi-field fixed-width record, docs/memory-layout.md):
 * `domain` is omitted — each field's own PICTURE bounds its domain, read
 * from the input file's `layout` in the IR. baseCase lines are raw
 * full-width records.
 */
export interface RecordsConfig {
  domain?: string;
  min?: number;
  max: number;
}

export interface GeneratorConfig {
  /** Path to the module's IR (relative to the config file). */
  ir: string;
  /** Data-division item names, one per stdin line, defining the input domain. */
  stdinFields?: string[];
  /** Record-stream mode: variable-length cases of file records (mutually exclusive with stdinFields). */
  records?: RecordsConfig;
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
  stdinFields?: string[];
  /** Record-stream mode (mutually exclusive with stdinFields): slots 0..max-1 become the input variables and the record count renders through the loop unroller. */
  records?: RecordsConfig;
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
  /**
   * Cap on enumerated paths (default 64). A RESOURCE bound, not a soundness
   * one — exceeding it refuses loudly rather than truncating — so it is
   * per-module tunable. Real modules branch far more than the benchmark's.
   */
  maxPaths?: number;
}

export interface DiffConfig {
  legacy: SideConfig;
  modern: SideConfig;
  /**
   * Output contract. "kv-lines" parses KEY=VALUE pairs; "raw" compares
   * stdout byte for byte, which is what real COBOL needs — it prints
   * records, not pairs (docs/raw-protocol.md).
   */
  protocol?: { input: "stdin-lines"; output: "kv-lines" | "raw" };
  /** Absolute tolerance for numeric fields. Default 0 — exact or fail. */
  numericTolerance?: number;
  timeoutMs?: number;
  /** Curated cases (layer B). May be empty when a generator is used (layer A). */
  cases?: DiffCase[];
  /** Property-based generation settings (layer A). */
  generator?: GeneratorConfig;
  /** Symbolic-execution settings (layer C). */
  symbolic?: SymbolicConfig;
  /**
   * Declares that abnormal termination is part of this module's SPECIFIED
   * behaviour, i.e. its IR contains a `terminate-abnormal` statement
   * (docs/external-services.md). Written in the config by hand, like every
   * other field here, and then CHECKED against the IR by loadConfig — the
   * declaration is never taken on trust.
   *
   * Without it, any nonzero exit is an ERROR, which conflates "the program
   * terminated abnormally, as written" with "the harness malfunctioned" and
   * makes such a module unverifiable in principle. With it, the exit status
   * becomes a COMPARED OBSERVABLE: the two sides must agree on it, and a
   * matched nonzero exit is a legitimate outcome whose stdout is then diffed
   * as usual.
   *
   * Deliberately opt-in per module, so the bar for every module that does
   * NOT abend is bit-for-bit what it was before.
   */
  abnormalTermination?: boolean;
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
  kind:
    | "numeric-divergence"
    | "string-divergence"
    | "missing-in-legacy"
    | "missing-in-modern"
    | "exit-status-divergence"
    | "raw-output-divergence";
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
    const argvOk = Array.isArray(s?.argv) && s.argv.length > 0 && s.argv.every((a) => typeof a === "string");
    const imageOk = typeof s?.image === "string" && s.image.length > 0;
    if (!s || (!argvOk && !imageOk)) {
      throw new DiffExecError(`config: "${side}" needs a non-empty "argv" array or a persistent-container "image"`);
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
  if (c.abnormalTermination !== undefined) {
    if (typeof c.abnormalTermination !== "boolean") {
      throw new DiffExecError('config: "abnormalTermination" must be a boolean');
    }
    // The declaration RELAXES the bar (a nonzero exit stops being an error),
    // so it may not be taken on trust: it has to be justified by the module's
    // own IR. Otherwise a config could quietly excuse a module that crashes.
    if (c.abnormalTermination) {
      const irPath = c.generator?.ir ?? c.symbolic?.ir;
      if (!irPath) {
        throw new DiffExecError(
          'config: "abnormalTermination" needs a "generator.ir" or "symbolic.ir" reference so the ' +
            "declaration can be checked against the IR",
        );
      }
      const resolved = resolve(dirname(resolve(configPath)), irPath);
      let ir: unknown;
      try {
        ir = JSON.parse(readFileSync(resolved, "utf8"));
      } catch (e) {
        throw new DiffExecError(`config: cannot read IR ${resolved} to check "abnormalTermination": ${(e as Error).message}`);
      }
      if (!irHasTerminateAbnormal(ir)) {
        throw new DiffExecError(
          `config: "abnormalTermination" is declared but ${irPath} contains no terminate-abnormal ` +
            "statement — the module does not abend, so the relaxed exit-status rule is unjustified",
        );
      }
    }
  }
  return c;
}

/** Nested statement-list keys, mirroring ir-core's NESTED. */
const NESTED_ARMS = ["then", "else", "atEnd", "notAtEnd"] as const;

/** True if any statement anywhere in the IR is a `terminate-abnormal`. */
function irHasTerminateAbnormal(ir: unknown): boolean {
  const scan = (stmts: unknown): boolean => {
    if (!Array.isArray(stmts)) return false;
    for (const s of stmts) {
      if (!s || typeof s !== "object") continue;
      const st = s as Record<string, unknown>;
      if (st.kind === "terminate-abnormal") return true;
      for (const arm of NESTED_ARMS) if (scan(st[arm])) return true;
    }
    return false;
  };
  const paras = (ir as { procedureDivision?: { paragraphs?: { statements?: unknown }[] } })?.procedureDivision
    ?.paragraphs;
  if (!Array.isArray(paras)) return false;
  return paras.some((p) => scan(p?.statements));
}

// --- persistent containers ------------------------------------------------------
//
// One `sleep infinity` container per image, shared by every case this
// process runs; each case is a `docker exec -i` of the image's own
// entrypoint. Same compiled binary, same `--network none` sandbox — minus
// the per-case container startup. Containers are labeled and removed on
// process exit; a crashed process can leave one behind, removable with
//   docker rm -f $(docker ps -q --filter label=legacymind-harness)

interface PersistentContainer {
  id: string;
  command: string[];
}

const persistentContainers = new Map<string, PersistentContainer>();
let cleanupHooked = false;

function dockerOrFail(args: string[], what: string): string {
  const res = spawnSync("docker", args, { encoding: "utf8", windowsHide: true });
  if (res.status !== 0 || res.error) {
    throw new DiffExecError(`harness: ${what} failed: ${(res.stderr || String(res.error || "")).trim()}`);
  }
  return res.stdout.trim();
}

function persistentContainer(image: string): PersistentContainer {
  const existing = persistentContainers.get(image);
  if (existing) return existing;
  const raw = dockerOrFail(
    ["inspect", "--format", "{{json .Config.Entrypoint}}\t{{json .Config.Cmd}}", image],
    `docker inspect ${image}`,
  );
  const [epRaw, cmdRaw] = raw.split("\t");
  const command: string[] = [...(JSON.parse(epRaw ?? "null") ?? []), ...(JSON.parse(cmdRaw ?? "null") ?? [])];
  if (command.length === 0) {
    throw new DiffExecError(`harness: image ${image} has no entrypoint/cmd to exec per case`);
  }
  const id = dockerOrFail(
    ["run", "-d", "--rm", "--network", "none", "--label", "legacymind-harness=1", "--entrypoint", "sleep", image, "infinity"],
    `starting persistent container for ${image}`,
  );
  const container = { id, command };
  persistentContainers.set(image, container);
  if (!cleanupHooked) {
    cleanupHooked = true;
    process.on("exit", stopPersistentContainers);
  }
  return container;
}

/**
 * Persistent container for the SANDBOXED JAVA side (LM_JAVA_IMAGE): one
 * long-lived `sleep infinity` container per (image, classpath) pair —
 * the classpath is a per-candidate read-only mount, so it is part of the
 * key — and each case is a `docker exec java -cp /work …`. Same shape and
 * cleanup as the legacy side's persistent container; the startup cost is
 * paid once per process instead of once per case.
 */
function persistentJavaContainer(image: string, cpAbs: string): PersistentContainer {
  const key = `${image} ${cpAbs}`;
  const existing = persistentContainers.get(key);
  if (existing) return existing;
  const id = dockerOrFail(
    ["run", "-d", "--rm", "--network", "none", "--label", "legacymind-harness=1",
      "-v", `${cpAbs}:/work:ro`, "--entrypoint", "sleep", image, "infinity"],
    `starting persistent java container for ${image} (${cpAbs})`,
  );
  const container = { id, command: ["java", "-cp", "/work"] };
  persistentContainers.set(key, container);
  if (!cleanupHooked) {
    cleanupHooked = true;
    process.on("exit", stopPersistentContainers);
  }
  return container;
}

/** Human-readable side description for logs. */
export function sideLabel(side: SideConfig): string {
  return side.label ?? (side.image ? `persistent container of ${side.image}` : side.argv!.join(" "));
}

/** Artifact reference for reports: how the side was invoked. */
export function sideRef(side: SideConfig): { argv: string[] | null; image: string | null } {
  return { argv: side.argv ?? null, image: side.image ?? null };
}

export function stopPersistentContainers(): void {
  for (const { id } of persistentContainers.values()) {
    spawnSync("docker", ["rm", "-f", id], { encoding: "utf8", windowsHide: true });
  }
  persistentContainers.clear();
}

export function runSide(side: SideConfig, stdinLines: string[], baseDir: string, timeoutMs: number): RunResult {
  const started = Date.now();
  let argv0: string;
  let argvRest: string[];
  // The modern Java side runs in a pinned OpenJDK container when
  // LM_JAVA_IMAGE is set (harness/openjdk), so it carries the same
  // provenance and sandbox — pinned runtime, no network, ephemeral fs,
  // read-only classpath — as the legacy GnuCOBOL container. Opt-in and
  // shape-gated (a `java -cp <dir> <Main>` argv), so configs are unchanged
  // and an unset env keeps the host-JDK path exactly as before.
  const javaImage = process.env.LM_JAVA_IMAGE;
  const containerizeJava =
    !side.image && javaImage && side.argv?.[0] === "java" && side.argv[1] === "-cp" && side.argv.length >= 4;
  if (side.image) {
    const c = persistentContainer(side.image);
    const envFlags = Object.entries(side.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    argv0 = "docker";
    argvRest = ["exec", "-i", ...envFlags, c.id, ...c.command];
  } else if (containerizeJava) {
    // Docker needs the drive-letter path with forward slashes (C:/...); the
    // classpath dir mounts read-only at /work in a persistent per-(image,
    // classpath) container, and each case is an exec — container startup is
    // paid once per process, not per case (the legacy side's fast mode).
    const cpAbs = resolve(baseDir, side.argv![2]!).replace(/\\/g, "/");
    const rest = side.argv!.slice(3);
    const envFlags = Object.entries(side.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const c = persistentJavaContainer(javaImage!, cpAbs);
    argv0 = "docker";
    argvRest = ["exec", "-i", ...envFlags, c.id, ...c.command, ...rest];
  } else {
    argv0 = side.argv![0]!;
    argvRest = side.argv!.slice(1);
  }
  const res = spawnSync(argv0, argvRest, {
    cwd: baseDir,
    // A zero-line case is a genuinely EMPTY stream: a bare trailing newline
    // would read as one blank record under the record protocol (caught by
    // the BATCHSUM empty-file case, where the legacy side counted 1).
    input: stdinLines.length > 0 ? stdinLines.join("\n") + "\n" : "",
    encoding: "utf8",
    timeout: timeoutMs,
    // side.env is passed to the candidate via -e in both container modes;
    // only the plain host-spawn path injects it into the process env.
    env: { ...process.env, ...(side.image || containerizeJava ? {} : side.env ?? {}) },
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

  // A spawn failure or timeout is the HARNESS breaking and is always an
  // ERROR. A nonzero exit is a property of the program under test, so it is
  // only an error when the module never claimed to terminate abnormally.
  const harnessBroke = legacyRun.error !== undefined || modernRun.error !== undefined;
  const abnormalDeclared = config.abnormalTermination === true;
  const sameExit = legacyRun.exitCode === modernRun.exitCode;
  // A null exit status means the process was killed by a signal rather than
  // exiting — that is the harness or the OS intervening, never a specified
  // abend, so it must not be matchable. Both sides must have really exited.
  const bothExited = typeof legacyRun.exitCode === "number" && typeof modernRun.exitCode === "number";
  const bothNonZero = bothExited && legacyRun.exitCode !== 0 && modernRun.exitCode !== 0;

  const rawProtocol = config.protocol?.output === "raw";

  /** Byte-for-byte stdout equality — the only honest contract for a module
   *  whose output is not KEY=VALUE (real COBOL prints records, not pairs). */
  const compareRaw = (): void => {
    compared = 1;
    diffs =
      legacyRun.stdout === modernRun.stdout
        ? []
        : [
            {
              field: "<stdout>",
              kind: "raw-output-divergence",
              legacy: JSON.stringify(legacyRun.stdout).slice(0, 400),
              modern: JSON.stringify(modernRun.stdout).slice(0, 400),
            },
          ];
  };

  const compareStdout = (): void => {
    if (rawProtocol) {
      compareRaw();
      return;
    }
    const legacyFields = parseKv(legacyRun.stdout, "legacy", notes);
    const modernFields = parseKv(modernRun.stdout, "modern", notes);
    ({ diffs, compared } = compareFields(legacyFields, modernFields, tolerance));
    // A case that compared NOTHING is not a pass. Under the KV protocol a
    // module whose output is not KEY=VALUE parses to zero fields on both
    // sides, and "no differences among no fields" would certify a candidate
    // that printed nothing at all — measured, it did. Fall back to raw
    // stdout equality, which is strictly stronger and cannot regress a
    // module that does emit fields.
    if (compared === 0) {
      notes.push(
        "no KEY=VALUE fields were parsed from either side; falling back to byte-for-byte stdout " +
          'comparison (set protocol.output to "raw" to make this the contract)',
      );
      compareRaw();
    }
  };

  if (harnessBroke) {
    status = "ERROR";
    if (legacyRun.error) notes.push(`legacy: ${legacyRun.error}`);
    if (modernRun.error) notes.push(`modern: ${modernRun.error}`);
  } else if (abnormalDeclared && bothExited && !sameExit) {
    // Termination status as an observable: one side ended the run and the
    // other did not, which is a behavioural divergence with a counterexample
    // — not a harness fault. Reported as a FAIL so it lands in the diff list.
    status = "FAIL";
    diffs = [
      {
        field: "<exit status>",
        kind: "exit-status-divergence",
        legacy: String(legacyRun.exitCode),
        modern: String(modernRun.exitCode),
      },
    ];
    compared = 1;
  } else if (abnormalDeclared && sameExit && bothNonZero) {
    // Both terminated abnormally, identically. That is a legitimate outcome
    // for this module, so the case is judged on its output like any other —
    // and the note keeps it visible in a PASS report, because a pass that
    // quietly involved an abend would be a hidden failure.
    notes.push(`both sides terminated abnormally with exit code ${legacyRun.exitCode} (declared)`);
    compareStdout();
    compared += 1; // the matched exit status is itself a compared observable
    status = diffs.length === 0 ? "PASS" : "FAIL";
  } else if (legacyRun.exitCode !== 0 || modernRun.exitCode !== 0) {
    status = "ERROR";
    if (legacyRun.exitCode !== 0) notes.push(`legacy: exit code ${legacyRun.exitCode}`);
    if (modernRun.exitCode !== 0) notes.push(`modern: exit code ${modernRun.exitCode}`);
  } else {
    compareStdout();
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
const imageIdCache = new Map<string, string | null>();

export function artifactHash(side: SideConfig, baseDir: string): string | null {
  if (side.image) {
    // The docker image ID is the artifact identity: it covers the compiled
    // binary AND its runtime, which is stronger provenance than hashing a
    // command string.
    let id = imageIdCache.get(side.image);
    if (id === undefined) {
      const res = spawnSync("docker", ["inspect", "--format", "{{.Id}}", side.image], {
        encoding: "utf8",
        windowsHide: true,
      });
      id = res.status === 0 ? res.stdout.trim().replace(/^sha256:/, "") : null;
      imageIdCache.set(side.image, id);
    }
    return id;
  }
  for (const a of (side.argv ?? []).slice(1)) {
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
      } else if (
        d.kind === "string-divergence" ||
        d.kind === "exit-status-divergence" ||
        d.kind === "raw-output-divergence"
      ) {
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
        ...sideRef(config.legacy),
        sha256: artifactHash(config.legacy, baseDir),
      },
      modern: {
        label: config.modern.label ?? null,
        ...sideRef(config.modern),
        sha256: artifactHash(config.modern, baseDir),
      },
    },
    cases: results,
  };

  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log(`legacymind verify (layer B: differential execution)`);
  console.log(`  legacy: ${sideLabel(config.legacy)}`);
  console.log(`  modern: ${sideLabel(config.modern)}`);
  console.log("");
  printCaseResults(results);
  console.log("");
  console.log(
    `  verdict: ${verdict}  (${summary.passed}/${summary.total} passed, ${summary.failed} failed, ${summary.errored} errored)`,
  );
  console.log(`  report: ${outPath}`);

  return verdict === "PASS" ? 0 : 1;
}
