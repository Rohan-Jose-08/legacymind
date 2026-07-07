#!/usr/bin/env node
/**
 * legacymind — CLI entry point.
 *
 * Implemented stages: parse (COBOL -> IR), plan (inventory + cost
 * estimate), migrate (LLM transpile + verifier-selected candidate), and
 * verify (layer A property-based, layer B differential execution).
 * Remaining stages (certify, report) exit loudly with code 2 rather than
 * pretending — see the root README for the roadmap.
 *
 * Exit codes: 0 success / verification PASS, 1 verification FAIL or no
 * winning candidate, 2 usage, configuration, or parse error.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ParseError, parseCobol } from "./parse/parser.js";
import { parseCobolProleap, PROLEAP_FORMATS } from "./parse/proleap.js";
import { DiffExecError, runDiffExec } from "./verify/diffexec.js";
import { runPropGen } from "./verify/propgen.js";
import { runSymExec } from "./verify/symexec.js";
import { runStaticFlow } from "./verify/staticflow.js";
import { MigrateError, runMigrate } from "./transpile/transpile.js";
import { ModelError } from "./model/client.js";
import { CertifyError, runCertify, runReport } from "./certify.js";
import { runPlan } from "./plan.js";

const DEFAULT_MODEL = "claude-opus-4-8";

const USAGE = `legacymind — autonomous legacy-code modernization with provable equivalence

usage:
  legacymind parse <source.cbl> --out <dir | file.json>
                   [--engine stub|proleap] [--format AUTO|FIXED|VARIABLE|TANDEM]
      Parse COBOL 85 into LegacyMind IR (ir/schema.json).
      When --out is a directory the file is named <PROGRAM-ID>.ir.json.
      Engines: stub (fixed-format subset, no JVM needed) or proleap
      (production ANTLR4 grammar + reference-format preprocessor; needs a
      JDK). --format applies to proleap only; AUTO tries FIXED, VARIABLE,
      then TANDEM.

  legacymind plan <ir.json | ir-dir> [--model ${DEFAULT_MODEL}]
      Module inventory and rough LLM cost estimate before migrating.

  legacymind migrate <ir.json> --diff-config <cfg.json> --out <dir>
                     [--prop-config <cfg.json>] [--model ${DEFAULT_MODEL}]
                     [--cache transpiler/cache] [--offline]
      Emit two prompt-variant Java 21 candidates through the replay cache,
      compile each with javac, run verifier layer B on each, and select
      the first candidate that passes. With --prop-config, winning also
      requires passing that config's layer A generated cases. Exit 1 when
      no candidate passes.

  legacymind verify --config <cfg.json> --out <report.json>
                    [--layer A|B|C|D] [--count N] [--seed S]
      Layer B (default): run the config's curated cases differentially.
      Layer A: generate cases from the data division per the config's
      "generator" block, run them, and shrink any counterexamples.
      Layer C: enumerate paths and derive boundary obligations per the
      config's "symbolic" block; any diverging path is a fail.
      Layer D: static data-flow equivalence per the config's "static"
      block (IR vs migrated Java) — no execution involved.

  legacymind certify --selection <selection.json> --out <certification.json>
                     [--layer-a <r.json>] [--layer-c <r.json>] [--layer-d <r.json>]
      Aggregate the winner's layer B report plus provided layer A/C/D
      reports into certification.json: per-layer verdicts, coverage
      envelope, every gap listed, integrity hash. Exit 1 if NOT_CERTIFIED.

  legacymind report <certification.json> [--out <file.md>]
      Render a certificate as human-readable Markdown (stdout by default).
`;

function fail(message: string, code: number): never {
  console.error(`legacymind: ${message}`);
  process.exit(code);
}

function parseArgs(args: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const boolean = new Set(["offline"]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (boolean.has(name)) {
        flags.set(name, true);
        continue;
      }
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) fail(`flag ${a} needs a value`, 2);
      flags.set(name, value);
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function str(flags: Map<string, string | true>, name: string): string | undefined {
  const v = flags.get(name);
  return typeof v === "string" ? v : undefined;
}

function cmdParse(args: string[]): void {
  const { positional, flags } = parseArgs(args);
  const src = positional[0];
  if (!src) fail("parse: missing <source.cbl>\n\n" + USAGE, 2);
  const out = str(flags, "out");
  if (!out) fail("parse: --out is required", 2);

  const engine = str(flags, "engine") ?? "stub";
  const format = (str(flags, "format") ?? "AUTO").toUpperCase();
  if (engine !== "stub" && engine !== "proleap") fail(`parse: unknown --engine "${engine}"`, 2);
  if (!(PROLEAP_FORMATS as readonly string[]).includes(format)) {
    fail(`parse: unknown --format "${format}" (${PROLEAP_FORMATS.join(", ")})`, 2);
  }

  let text: string;
  try {
    text = readFileSync(src, "utf8");
  } catch (e) {
    fail(`parse: cannot read ${src}: ${(e as Error).message}`, 2);
  }

  try {
    const { ir, summary } =
      engine === "proleap"
        ? parseCobolProleap(src.replace(/\\/g, "/"), format)
        : parseCobol(text, src.replace(/\\/g, "/"));
    const outPath = out.endsWith(".json") ? out : join(out, `${ir.module.programId}.ir.json`);
    mkdirSync(dirname(outPath) || ".", { recursive: true });
    writeFileSync(outPath, JSON.stringify(ir, null, 2) + "\n");

    console.log(`parsed ${summary.programId} (${src})`);
    console.log(`  data items: ${summary.dataItems}`);
    console.log(`  paragraphs: ${summary.paragraphs.length} (${summary.paragraphs.join(", ")})`);
    console.log(`  statements: ${summary.statements}`);
    console.log(`  cfg edges:  ${summary.edges}`);
    console.log(`  warnings:   ${summary.warnings.length}`);
    for (const w of summary.warnings) console.log(`    - ${w}`);
    console.log(`wrote ${outPath}`);
  } catch (e) {
    if (e instanceof ParseError) fail(`parse: ${src}: ${e.message}`, 2);
    throw e;
  }
}

function cmdVerify(args: string[]): void {
  const { flags } = parseArgs(args);
  const config = str(flags, "config");
  const out = str(flags, "out");
  if (!config || !out) fail("verify: --config and --out are required", 2);
  const layer = (str(flags, "layer") ?? "B").toUpperCase();
  try {
    if (layer === "B") {
      process.exit(runDiffExec(config, out));
    } else if (layer === "A") {
      const count = str(flags, "count");
      const seed = str(flags, "seed");
      process.exit(
        runPropGen(config, out, {
          count: count === undefined ? undefined : Number(count),
          seed: seed === undefined ? undefined : Number(seed),
        }),
      );
    } else if (layer === "C") {
      process.exit(runSymExec(config, out));
    } else if (layer === "D") {
      process.exit(runStaticFlow(config, out));
    } else {
      fail(`verify: unknown --layer "${layer}" (implemented: A, B, C, D)`, 2);
    }
  } catch (e) {
    if (e instanceof DiffExecError) fail(`verify: ${e.message}`, 2);
    throw e;
  }
}

async function cmdMigrate(args: string[]): Promise<void> {
  const { positional, flags } = parseArgs(args);
  const irPath = positional[0];
  if (!irPath) fail("migrate: missing <ir.json>", 2);
  const diffConfigPath = str(flags, "diff-config");
  const outDir = str(flags, "out");
  if (!diffConfigPath || !outDir) fail("migrate: --diff-config and --out are required", 2);
  try {
    process.exit(
      await runMigrate({
        irPath,
        diffConfigPath,
        outDir,
        model: str(flags, "model") ?? DEFAULT_MODEL,
        cacheDir: str(flags, "cache") ?? "transpiler/cache",
        offline: flags.get("offline") === true,
        propConfigPath: str(flags, "prop-config"),
      }),
    );
  } catch (e) {
    if (e instanceof MigrateError || e instanceof ModelError || e instanceof DiffExecError) {
      fail(`migrate: ${e.message}`, 2);
    }
    throw e;
  }
}

function cmdPlan(args: string[]): void {
  const { positional, flags } = parseArgs(args);
  const target = positional[0];
  if (!target) fail("plan: missing <ir.json | ir-dir>", 2);
  process.exit(runPlan(target, str(flags, "model") ?? DEFAULT_MODEL));
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "parse":
    cmdParse(rest);
    break;
  case "plan":
    cmdPlan(rest);
    break;
  case "migrate":
    await cmdMigrate(rest);
    break;
  case "verify":
    cmdVerify(rest);
    break;
  case "certify": {
    const { flags } = parseArgs(rest);
    const selection = str(flags, "selection");
    const out = str(flags, "out");
    if (!selection || !out) fail("certify: --selection and --out are required", 2);
    try {
      process.exit(
        runCertify({
          selectionPath: selection,
          layerAPath: str(flags, "layer-a"),
          layerCPath: str(flags, "layer-c"),
          layerDPath: str(flags, "layer-d"),
          outPath: out,
        }),
      );
    } catch (e) {
      if (e instanceof CertifyError) fail(`certify: ${e.message}`, 2);
      throw e;
    }
    break;
  }
  case "report": {
    const { positional, flags } = parseArgs(rest);
    const cert = positional[0];
    if (!cert) fail("report: missing <certification.json>", 2);
    try {
      process.exit(runReport(cert, str(flags, "out")));
    } catch (e) {
      if (e instanceof CertifyError) fail(`report: ${e.message}`, 2);
      throw e;
    }
    break;
  }
  case "--help":
  case "-h":
  case "help":
  case undefined:
    console.log(USAGE);
    process.exit(command === undefined ? 2 : 0);
    break;
  default:
    fail(`unknown command "${command}"\n\n` + USAGE, 2);
}
