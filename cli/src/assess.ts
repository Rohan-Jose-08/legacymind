/**
 * `legacymind assess` — the customer-facing codebase assessment.
 *
 * Walks a directory of COBOL sources, runs every file through the
 * production frontend (one batched JVM), and reports VERIFIABILITY
 * honestly, per module and in aggregate:
 *
 *   - VERIFIABLE — the module lowers completely into the IR: the full
 *     four-layer verification pipeline (and a signed certificate) is
 *     available for it today.
 *   - BLOCKED — the module parses but uses constructs outside the
 *     verified subset; every blocking construct is enumerated for that
 *     file (never a silent skip).
 *   - PARSE-FAILED — the grammar/preprocessor rejected the source (the
 *     exact error is reported; a missing copybook directory is the
 *     common cause — see --copybooks).
 *
 * The aggregate table ranks blockers by UNLOCK COUNT — how many modules
 * name that construct — and separately counts the modules blocked ONLY
 * by it (fixing that one construct makes them verifiable). Instance
 * counts inflate scaffolding; module counts are what an engagement plan
 * needs.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { ensureProleapFrontend, proleapClasspath } from "./parse/proleap.js";

export class AssessError extends Error {}

interface FileResult {
  file: string;
  ok: boolean;
  stage?: string;
  error?: string;
  unsupported?: string[];
}

interface ModuleVerdict {
  file: string;
  verdict: "VERIFIABLE" | "BLOCKED" | "PARSE-FAILED";
  blockers: string[];
  parseError?: string;
}

/** Normalize a rejection message into a construct bucket: drop line
 *  numbers and collapse identifiers so equivalent reasons group. */
function bucket(message: string): string {
  return message
    .replace(/^line \d+: /, "")
    .replace(/ ?\(line \d+\)/g, "")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/PICTURE \S+:/, "PICTURE …:")
    .replace(/line \d+:\d+ /, "")
    .slice(0, 110);
}

function walkCobol(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      if (name === ".git" || name === "node_modules") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(cbl|cob|ccp|cobol)$/i.test(name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

export function runAssess(opts: {
  dir: string;
  copybooks?: string;
  outDir: string;
  format?: string;
}): number {
  const files = walkCobol(resolve(opts.dir));
  if (files.length === 0) throw new AssessError(`no COBOL sources (*.cbl, *.cob) under ${opts.dir}`);
  console.log(`legacymind assess — ${files.length} source file(s) under ${opts.dir}`);
  if (opts.copybooks) console.log(`  copybooks: ${opts.copybooks}`);

  ensureProleapFrontend();
  const args = ["-cp", proleapClasspath(), "ProLeapFrontend", "--batch"];
  if (opts.format) args.push("--format", opts.format);
  if (opts.copybooks) args.push("--copybooks", resolve(opts.copybooks));
  const batch = spawnSync("java", args, {
    input: files.join("\n") + "\n",
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    windowsHide: true,
  });
  if (batch.error || batch.status !== 0) {
    throw new AssessError(`frontend batch failed: ${batch.error?.message ?? batch.stderr}`);
  }
  const results: FileResult[] = batch.stdout
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as FileResult);
  if (results.length !== files.length) {
    throw new AssessError(`frontend returned ${results.length} results for ${files.length} files`);
  }

  // --- per-module verdicts ----------------------------------------------------
  const verdicts: ModuleVerdict[] = results.map((r, i) => {
    const rel = relative(resolve(opts.dir), files[i]!).split("\\").join("/");
    if (r.ok) return { file: rel, verdict: "VERIFIABLE", blockers: [] };
    if (r.stage === "frontend" || r.stage === "asg") {
      return { file: rel, verdict: "PARSE-FAILED", blockers: [], parseError: bucket(r.error ?? "unknown") };
    }
    const blockers = [...new Set((r.unsupported ?? []).map(bucket))].sort();
    return { file: rel, verdict: "BLOCKED", blockers };
  });

  const verifiable = verdicts.filter((v) => v.verdict === "VERIFIABLE");
  const blocked = verdicts.filter((v) => v.verdict === "BLOCKED");
  const parseFailed = verdicts.filter((v) => v.verdict === "PARSE-FAILED");

  // --- the unlock table -------------------------------------------------------
  const byBucket = new Map<string, { modules: number; sole: number }>();
  for (const v of blocked) {
    for (const b of v.blockers) {
      const e = byBucket.get(b) ?? { modules: 0, sole: 0 };
      e.modules++;
      if (v.blockers.length === 1) e.sole++;
      byBucket.set(b, e);
    }
  }
  const unlockTable = [...byBucket.entries()]
    .map(([construct, e]) => ({ construct, modulesAffected: e.modules, modulesUnlocked: e.sole }))
    .sort((a, b) => b.modulesUnlocked - a.modulesUnlocked || b.modulesAffected - a.modulesAffected);

  // --- artifacts ---------------------------------------------------------------
  mkdirSync(resolve(opts.outDir), { recursive: true });
  const assessment = {
    tool: "legacymind assess",
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    codebase: resolve(opts.dir).replace(/\\/g, "/"),
    copybooks: opts.copybooks ? resolve(opts.copybooks).replace(/\\/g, "/") : null,
    summary: {
      files: files.length,
      verifiable: verifiable.length,
      blocked: blocked.length,
      parseFailed: parseFailed.length,
    },
    unlockTable,
    modules: verdicts,
  };
  const jsonPath = join(resolve(opts.outDir), "assessment.json");
  writeFileSync(jsonPath, JSON.stringify(assessment, null, 2) + "\n");

  const pct = (n: number) => ((100 * n) / files.length).toFixed(1);
  const md: string[] = [];
  md.push(`# LegacyMind codebase assessment`);
  md.push(``);
  md.push(`Generated ${assessment.generatedAt} over \`${assessment.codebase}\` (${files.length} COBOL source files).`);
  md.push(``);
  md.push(`| | modules | share |`);
  md.push(`|---|---:|---:|`);
  md.push(`| **Verifiable today** — full four-layer verification and a signed certificate are available now | ${verifiable.length} | ${pct(verifiable.length)}% |`);
  md.push(`| **Blocked** — parses, but uses constructs outside the verified subset (each enumerated below) | ${blocked.length} | ${pct(blocked.length)}% |`);
  md.push(`| **Parse failed** — the grammar/preprocessor rejected the source | ${parseFailed.length} | ${pct(parseFailed.length)}% |`);
  md.push(``);
  md.push(`Nothing in this report is sampled or estimated: every file was parsed, and`);
  md.push(`every blocking construct in every file is enumerated. A module marked`);
  md.push(`verifiable is eligible for the full pipeline — differential execution and`);
  md.push(`property testing against the real GnuCOBOL binary, path-sensitive symbolic`);
  md.push(`verification, static data-flow equivalence, and an Ed25519-signed certificate`);
  md.push(`that names every disclosed gap.`);
  md.push(``);
  if (verifiable.length > 0) {
    md.push(`## Verifiable now (${verifiable.length})`);
    md.push(``);
    for (const v of verifiable) md.push(`- \`${v.file}\``);
    md.push(``);
  }
  if (unlockTable.length > 0) {
    md.push(`## What unlocks the rest`);
    md.push(``);
    md.push(`Ranked by modules **unlocked** (blocked by nothing else), then by modules affected.`);
    md.push(``);
    md.push(`| construct outside the subset | modules affected | modules unlocked by fixing only this |`);
    md.push(`|---|---:|---:|`);
    for (const u of unlockTable.slice(0, 25)) {
      md.push(`| ${u.construct.replace(/\|/g, "\\|")} | ${u.modulesAffected} | ${u.modulesUnlocked} |`);
    }
    md.push(``);
  }
  if (blocked.length > 0) {
    md.push(`## Per-module blockers (${blocked.length} blocked)`);
    md.push(``);
    for (const v of blocked) {
      md.push(`- \`${v.file}\` — ${v.blockers.length} distinct construct(s):`);
      for (const b of v.blockers.slice(0, 6)) md.push(`  - ${b}`);
      if (v.blockers.length > 6) md.push(`  - … ${v.blockers.length - 6} more (see assessment.json)`);
    }
    md.push(``);
  }
  if (parseFailed.length > 0) {
    md.push(`## Parse failures (${parseFailed.length})`);
    md.push(``);
    md.push(`A missing copybook directory is the most common cause — re-run with \`--copybooks <dir>\`.`);
    md.push(``);
    for (const v of parseFailed) md.push(`- \`${v.file}\` — ${v.parseError}`);
    md.push(``);
  }
  const mdPath = join(resolve(opts.outDir), "ASSESSMENT.md");
  writeFileSync(mdPath, md.join("\n") + "\n");

  console.log(`  verifiable now:   ${verifiable.length}/${files.length} (${pct(verifiable.length)}%)`);
  console.log(`  blocked:          ${blocked.length} (constructs enumerated per module)`);
  console.log(`  parse failures:   ${parseFailed.length}`);
  console.log(`  report:           ${mdPath}`);
  console.log(`  machine-readable: ${jsonPath}`);
  return 0;
}
