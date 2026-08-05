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
import { runSymExec, SymbolicDeclined } from "./verify/symexec.js";
import { runStaticFlow } from "./verify/staticflow.js";
import { AssessError, runAssess } from "./assess.js";
import { MigrateError, runMigrate } from "./transpile/transpile.js";
import { ModelError } from "./model/client.js";
import { CertifyError, runCertify, runReport } from "./certify.js";
import { SignError, verifyCertificate } from "./sign.js";
import { runPlan } from "./plan.js";

const DEFAULT_MODEL = "claude-opus-4-8";

const USAGE = `legacymind — autonomous legacy-code modernization with provable equivalence

usage:
  legacymind assess <codebase-dir> --out <dir> [--copybooks <dir>]
                    [--format AUTO|FIXED|VARIABLE|TANDEM]
      Assess every COBOL source under a directory: per-module verdicts
      (VERIFIABLE today / BLOCKED with each file's enumerated constructs /
      PARSE-FAILED), plus an unlock-ranked construct table. Writes
      ASSESSMENT.md (customer-readable) and assessment.json.

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
                     [--cache transpiler/cache] [--offline] [--max-repairs N]
                     [--max-tokens N]
      Emit two prompt-variant Java 21 candidates through the replay cache,
      compile each with javac, run verifier layer B on each, and select
      the first candidate that passes. With --prop-config, winning also
      requires passing that config's layer A generated cases. With
      --max-repairs N, a failing round hands each candidate its verifier
      evidence (compiler output or failing cases) back to the model for up
      to N bounded repair rounds — every repair request cached and
      replayable like any other call. Exit 1 when
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
                     [--signing-key <ed25519.pem>]
  legacymind certify --audit-java <Main.java> --layer-b <r.json> --ir <ir.json>
                     --out <certification.json> [--layer-a/-c/-d <r.json>]
      AUDIT MODE: certify a Java artifact this pipeline did NOT generate —
      someone else's migration, or an in-house one. Provenance is recorded
      as SUPPLIED, with no model and no candidate, so the certificate can
      never be read as evidence about the transpiler.
      Aggregate the winner's layer B report plus provided layer A/C/D
      reports into certification.json: per-layer verdicts, coverage
      envelope, every gap listed, Ed25519 signature. Exit 1 if
      NOT_CERTIFIED. Signs with the committed demo key unless
      --signing-key (or $LEGACYMIND_SIGNING_KEY) gives a production key.

  legacymind verify-cert <certification.json> [--trusted-key <ed25519.pub.pem>]
      Verify a certificate's Ed25519 signature (integrity) and pin the
      signer against the trusted public key (provenance). Exit 0 only if
      the signature is valid AND the signer is trusted; any tampering or
      unknown signer exits 1, loudly. Defaults to the committed demo key.

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
        ? parseCobolProleap(src.replace(/\\/g, "/"), format, str(flags, "copybooks"))
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

/**
 * Write layer C's structural decline as a report artifact.
 *
 * Deliberately minimal, and deliberately NOT shaped like a passing report:
 * it carries no summary, no obligations and no path counts, because a
 * decline establishes nothing about the module beyond the fact that this
 * engine will not reason about it. `certify` hashes this file and lifts
 * `reason` verbatim into the signed certificate.
 */
function writeDeclineReport(configPath: string, outPath: string, reason: string): void {
  let ir: string | null = null;
  try {
    ir = JSON.parse(readFileSync(configPath, "utf8")).symbolic?.ir ?? null;
  } catch {
    // A decline can outlive an unreadable config; the reason is the payload.
  }
  mkdirSync(dirname(outPath) || ".", { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        tool: "legacymind verify --layer C",
        verdict: "DECLINED",
        reason,
        config: configPath.replace(/\\/g, "/"),
        ir,
        generatedAt: new Date().toISOString(),
        note:
          "Layer C refused this module because of the PROGRAM's shape, not because of a " +
          "configuration error. This is an absence of evidence with a named cause; it is not " +
          "a failure, and it must not be read as one. See docs/layer-c-declines.md.",
      },
      null,
      2,
    ) + "\n",
  );
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
      // A structural decline is EVIDENCE ABOUT THE MODULE, so it is written
      // out rather than only printed. Without the artifact, `certify` cannot
      // tell "layer C cannot reason about this program" from "nobody ran
      // layer C", and says the weaker of the two (docs/layer-c-declines.md).
      // The exit code is unchanged: a decline is still not a pass, and
      // nothing that gates on exit status moves.
      try {
        process.exit(runSymExec(config, out));
      } catch (e) {
        if (!(e instanceof SymbolicDeclined)) throw e;
        writeDeclineReport(config, out, e.message);
        console.error(`legacymind: verify: ${e.message}`);
        console.error(`  wrote DECLINED report to ${out} — certify records this as a named gap`);
        process.exit(2);
      }
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
        maxRepairs: str(flags, "max-repairs") ? Number.parseInt(str(flags, "max-repairs")!, 10) : 0,
        // Part of the replay-cache key, so the default stays pinned at 8192
        // and only an explicit flag changes it (see runMigrate).
        maxTokens: str(flags, "max-tokens") ? Number.parseInt(str(flags, "max-tokens")!, 10) : undefined,
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

function cmdAssess(args: string[]): void {
  const { positional, flags } = parseArgs(args);
  const dir = positional[0];
  const outDir = str(flags, "out");
  if (!dir || !outDir) fail("assess: usage: assess <codebase-dir> --out <dir> [--copybooks <dir>]", 2);
  try {
    process.exit(
      runAssess({
        dir,
        outDir,
        copybooks: str(flags, "copybooks"),
        format: str(flags, "format"),
      }),
    );
  } catch (e) {
    if (e instanceof AssessError) fail(`assess: ${e.message}`, 2);
    throw e;
  }
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case "parse":
    cmdParse(rest);
    break;
  case "assess":
    cmdAssess(rest);
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
    const auditJava = str(flags, "audit-java");
    const out = str(flags, "out");
    if (!out) fail("certify: --out is required", 2);
    if (!selection && !auditJava) {
      fail("certify: needs --selection <selection.json> or --audit-java <Main.java>", 2);
    }
    try {
      process.exit(
        runCertify({
          selectionPath: selection,
          auditJavaPath: auditJava,
          layerBPath: str(flags, "layer-b"),
          layerAPath: str(flags, "layer-a"),
          layerCPath: str(flags, "layer-c"),
          layerDPath: str(flags, "layer-d"),
          outPath: out,
          signingKeyPath: str(flags, "signing-key"),
          toolchainPath: str(flags, "toolchain"),
          irPath: str(flags, "ir"),
        }),
      );
    } catch (e) {
      if (e instanceof CertifyError || e instanceof SignError) fail(`certify: ${e.message}`, 2);
      throw e;
    }
    break;
  }
  case "verify-cert": {
    const { positional, flags } = parseArgs(rest);
    const certPath = positional[0];
    if (!certPath) fail("verify-cert: missing <certification.json>", 2);
    let cert: unknown;
    try {
      cert = JSON.parse(readFileSync(certPath, "utf8"));
    } catch (e) {
      fail(`verify-cert: cannot read ${certPath}: ${(e as Error).message}`, 2);
    }
    const result = verifyCertificate(cert, str(flags, "trusted-key"));
    console.log(`legacymind verify-cert — ${certPath}`);
    console.log(`  signature: ${result.signatureValid ? "VALID" : "INVALID"}`);
    console.log(`  content hash: ${result.contentHashValid ? "matches" : "MISMATCH"}`);
    console.log(
      `  signer key: ${result.keyId}` +
        (result.keyTrusted === true
          ? " (trusted)"
          : result.keyTrusted === false
            ? ` (UNTRUSTED — trusted is ${result.trustedKeyId})`
            : " (no trusted key to pin against)"),
    );
    for (const r of result.reasons) console.log(`  - ${r}`);
    console.log("");
    console.log(`  result: ${result.ok ? "VERIFIED" : "REJECTED"}`);
    process.exit(result.ok ? 0 : 1);
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
