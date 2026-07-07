/**
 * ProLeap parse engine — TypeScript side.
 *
 * Spawns the Java frontend (parser/proleap) that runs the ProLeap ANTLR4
 * COBOL 85 parser and lowers its ASG into LegacyMind IR. The class is
 * compiled on demand with javac (same convention as verifier/javaflow);
 * the jars in parser/proleap/lib are committed, so no network or build
 * system is needed.
 *
 * The frontend reports failures in two stages: "frontend" (grammar or
 * preprocessor rejected the source) and "ir" (parsed fine, but some
 * constructs fall outside the IR subset — every one is listed). Both
 * surface here as ParseError so the CLI contract matches the stub engine.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ParseError, type ModuleIR, type ParseSummary, type Statement } from "./parser.js";

export const PROLEAP_FORMATS = ["AUTO", "FIXED", "VARIABLE", "TANDEM"] as const;

interface FrontendResult {
  ok: boolean;
  format?: string;
  stage?: "frontend" | "asg" | "ir";
  error?: string;
  unsupported?: string[];
  ir?: ModuleIR;
}

function parserDir(): string {
  // cli/dist/parse/proleap.js -> <repo>/parser/proleap
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "parser", "proleap");
}

export function proleapClasspath(): string {
  const dir = parserDir();
  const lib = join(dir, "lib");
  if (!existsSync(lib)) {
    throw new ParseError(`proleap engine: ${lib} not found (jars are committed — is the checkout complete?)`, 1);
  }
  const jars = readdirSync(lib)
    .filter((f) => f.endsWith(".jar"))
    .map((f) => join(lib, f));
  if (jars.length === 0) throw new ParseError(`proleap engine: no jars in ${lib}`, 1);
  return [...jars, join(dir, "classes")].join(delimiter);
}

/** Compile ProLeapFrontend.java when the class is missing or stale. */
export function ensureProleapFrontend(): void {
  const dir = parserDir();
  const src = join(dir, "src", "ProLeapFrontend.java");
  const cls = join(dir, "classes", "ProLeapFrontend.class");
  if (existsSync(cls) && statSync(cls).mtimeMs >= statSync(src).mtimeMs) return;
  mkdirSync(join(dir, "classes"), { recursive: true });
  const res = spawnSync("javac", ["-cp", proleapClasspath(), "-d", join(dir, "classes"), src], {
    encoding: "utf8",
  });
  if (res.error || res.status !== 0) {
    throw new ParseError(
      `proleap engine: javac failed (JDK required): ${res.error?.message ?? res.stderr}`,
      1,
    );
  }
}

export function parseCobolProleap(
  sourceFile: string,
  format: string,
): { ir: ModuleIR; summary: ParseSummary } {
  ensureProleapFrontend();
  const res = spawnSync(
    "java",
    ["-cp", proleapClasspath(), "ProLeapFrontend", sourceFile, "--format", format],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.error) throw new ParseError(`proleap engine: java failed: ${res.error.message}`, 1);
  let result: FrontendResult;
  try {
    result = JSON.parse(res.stdout) as FrontendResult;
  } catch {
    throw new ParseError(
      `proleap engine: unparseable frontend output (exit ${res.status}): ${res.stderr || res.stdout}`.slice(0, 500),
      1,
    );
  }
  if (!result.ok || !result.ir) {
    const reasons =
      result.unsupported && result.unsupported.length > 0
        ? `\n  - ${result.unsupported.join("\n  - ")}`
        : ` ${result.error ?? "unknown error"}`;
    throw new ParseError(`[${result.stage ?? "frontend"}]${reasons}`, 1);
  }
  return { ir: result.ir, summary: summarize(result.ir) };
}

function countStatements(stmts: Statement[]): number {
  return stmts.reduce(
    (n, s) => n + 1 + (s.kind === "if" ? countStatements(s.then) + countStatements(s.else ?? []) : 0),
    0,
  );
}

function countItems(items: ModuleIR["dataDivision"]["items"]): number {
  return items.reduce((n, i) => n + 1 + countItems(i.children), 0);
}

export function summarize(ir: ModuleIR): ParseSummary {
  return {
    programId: ir.module.programId,
    paragraphs: ir.procedureDivision.paragraphs.map((p) => p.name),
    dataItems: countItems(ir.dataDivision.items),
    statements: ir.procedureDivision.paragraphs.reduce((n, p) => n + countStatements(p.statements), 0),
    edges: ir.controlFlow.edges.length,
    warnings: ir.provenance.warnings,
  };
}
