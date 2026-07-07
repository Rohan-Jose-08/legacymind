/**
 * `legacymind migrate` — LLM-driven modernization of one IR module into
 * Java 21, with verifier-driven candidate selection.
 *
 * Flow:
 *   1. Build a deterministic prompt per candidate from the module IR
 *      (provenance is stripped so the cache key survives re-parses).
 *   2. Resolve each candidate through the replay cache (model/client.ts);
 *      live calls happen only when the cache misses and credentials exist.
 *   3. Compile each candidate with `javac --release 21`. A compile failure
 *      rejects the candidate, loudly, with the compiler output preserved.
 *   4. Run verifier layer B (the diff-exec cases from --diff-config)
 *      against every compiled candidate and pick the first that passes.
 *      No passing candidate → no winner, exit 1. The verifier decides;
 *      the LLM never grades its own homework.
 *
 * Candidate diversity: the founding spec called for temperature-diverse
 * candidates. Current Claude models (Opus 4.7+) removed sampling
 * parameters entirely, so candidates are prompt-variant-diverse instead:
 * "faithful" (semantics-first) and "idiomatic" (modern-Java-first).
 *
 * The system prompt deliberately does NOT spell out COBOL's ROUNDED
 * (half-up) semantics in Java terms. Encoding every legacy semantic in a
 * prompt is exactly the fragile approach LegacyMind exists to replace —
 * the verifier, not the prompt, is what guarantees equivalence.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { completeWithCache, MissingCacheEntryError, type CachedCompletion } from "../model/client.js";
import {
  loadConfig,
  runDiffCases,
  printCaseResults,
  type DiffConfig,
  type DiffSummary,
} from "../verify/diffexec.js";
import { generateCases, resolveGenerator } from "../verify/propgen.js";

export class MigrateError extends Error {}

const SYSTEM_PROMPT = `You are LegacyMind's COBOL-to-Java transpiler.

You receive the LegacyMind IR (a normalized JSON form) of one COBOL 85
module and emit exactly one complete Java 21 source file.

Hard rules:
- Output a single \`\`\`java fenced code block and nothing else.
- Plain Java 21, standard library only: no frameworks, no dependencies.
- One public final class named after the PROGRAM-ID in PascalCase.
- I/O contract: read one value per line from stdin in ACCEPT order; write
  the same KEY=VALUE lines to stdout that the COBOL DISPLAY statements
  produce; exit 0 on success and 3 on invalid numeric input.
- All arithmetic uses java.math.BigDecimal. Never use float or double.
- Preserve the COBOL module's observable arithmetic behavior, including
  how COMPUTE statements with and without ROUNDED settle results into
  their target PICTURE's scale.
- Provenance: every method carries a comment naming the COBOL paragraph
  and source lines it implements; every constant or field comment names
  the COBOL data item and its PICTURE.`;

interface CandidateSpec {
  id: string;
  label: string;
  instruction: string;
}

const CANDIDATES: CandidateSpec[] = [
  {
    id: "a",
    label: "faithful",
    instruction:
      "Variant instruction: produce a FAITHFUL, semantics-preserving translation. " +
      "When Java idiom and exact COBOL behavior conflict, always choose exact COBOL behavior.",
  },
  {
    id: "b",
    label: "idiomatic",
    instruction:
      "Variant instruction: produce an IDIOMATIC modern Java translation. " +
      "Prefer standard Java library conventions and defaults where they appear behaviorally equivalent.",
  },
];

interface IrModule {
  irVersion: string;
  module: { programId: string; source: { file: string; sha256: string } };
  provenance?: unknown;
  [k: string]: unknown;
}

export function pascalCase(programId: string): string {
  return programId
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join("");
}

export function buildPrompt(ir: IrModule, candidate: CandidateSpec): string {
  // Strip provenance (generatedAt etc.) so identical source always yields
  // an identical prompt — and therefore an identical cache key.
  const { provenance: _omit, ...stable } = ir;
  return (
    `${candidate.instruction}\n\n` +
    `Target class name: ${pascalCase(ir.module.programId)}\n\n` +
    `LegacyMind IR of the module (JSON):\n\n` +
    JSON.stringify(stable, null, 2) +
    `\n`
  );
}

function extractJava(text: string): string {
  const fenced = /```java\s*\n([\s\S]*?)```/.exec(text);
  if (fenced) return fenced[1]!.trimEnd() + "\n";
  // Tolerate an unfenced response if it plainly is a Java file.
  if (/public\s+(final\s+)?class\s+/.test(text)) return text.trim() + "\n";
  throw new MigrateError("model response contained no ```java code block");
}

function extractClassName(java: string): string {
  const m = /public\s+(?:final\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(java);
  if (!m) throw new MigrateError("could not find a public class declaration in the generated Java");
  return m[1]!;
}

interface CandidateOutcome {
  id: string;
  label: string;
  cacheKey: string;
  fromCache: boolean;
  costUsd: number | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  javaFile: string | null;
  compile: { ok: boolean; output: string };
  verify: (DiffSummary & { verdict: "PASS" | "FAIL" }) | null;
  /** Layer A gate results, when --prop-config is given. */
  propVerify: (DiffSummary & { verdict: "PASS" | "FAIL"; seed: number; count: number }) | null;
}

export async function runMigrate(opts: {
  irPath: string;
  diffConfigPath: string;
  outDir: string;
  model: string;
  cacheDir: string;
  offline: boolean;
  /** Optional layer A config; when set, winning also requires the property gate. */
  propConfigPath?: string;
}): Promise<number> {
  const ir = JSON.parse(readFileSync(opts.irPath, "utf8")) as IrModule;
  if (ir.irVersion !== "0.1.0") throw new MigrateError(`unsupported irVersion ${ir.irVersion}`);
  const className = pascalCase(ir.module.programId);

  console.log(`legacymind migrate — ${ir.module.programId} -> Java 21 (${opts.model})`);
  console.log(`  cache: ${opts.cacheDir}${opts.offline ? " (offline: cache only)" : ""}`);
  console.log("");

  // --- 1+2: obtain both candidates (cache-first) -----------------------------
  const completions = new Map<string, CachedCompletion>();
  const missing: MissingCacheEntryError[] = [];
  for (const cand of CANDIDATES) {
    const req = {
      model: opts.model,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(ir, cand),
      maxTokens: 8192,
    };
    try {
      const completion = await completeWithCache(opts.cacheDir, req, { offline: opts.offline });
      completions.set(cand.id, completion);
      console.log(
        `  candidate ${cand.id} (${cand.label}): ${completion.fromCache ? "replayed from cache" : "live call"}` +
          ` [${completion.cacheKey.slice(0, 16)}…]` +
          (completion.fromCache
            ? ""
            : ` — ${completion.usage?.inputTokens ?? "?"} in / ${completion.usage?.outputTokens ?? "?"} out tokens,` +
              ` $${completion.costUsd?.toFixed(4) ?? "?"}`),
      );
    } catch (e) {
      if (e instanceof MissingCacheEntryError) {
        missing.push(e);
        console.error(`  candidate ${cand.id} (${cand.label}): MISSING — ${e.message.split("\n")[0]}`);
      } else {
        throw e;
      }
    }
  }
  if (missing.length > 0) {
    console.error("");
    for (const m of missing) console.error(m.message + "\n");
    throw new MigrateError(`${missing.length} candidate(s) unresolved — record responses or provide credentials`);
  }

  // --- 3: emit + compile ------------------------------------------------------
  const diffConfig = loadConfig(opts.diffConfigPath);
  const diffBaseDir = dirname(resolve(opts.diffConfigPath));
  const cases = diffConfig.cases ?? [];
  if (cases.length === 0) throw new MigrateError("the --diff-config has no cases to select candidates with");

  const outcomes: CandidateOutcome[] = [];
  for (const cand of CANDIDATES) {
    const completion = completions.get(cand.id)!;
    const outcome: CandidateOutcome = {
      id: cand.id,
      label: cand.label,
      cacheKey: completion.cacheKey,
      fromCache: completion.fromCache,
      costUsd: completion.costUsd,
      usage: completion.usage,
      javaFile: null,
      compile: { ok: false, output: "" },
      verify: null,
      propVerify: null,
    };
    outcomes.push(outcome);

    const java = extractJava(completion.text);
    const emittedClass = extractClassName(java);
    if (emittedClass !== className) {
      console.log(`  note: candidate ${cand.id} emitted class ${emittedClass} (expected ${className}); using it`);
    }
    const header =
      `// GENERATED BY legacymind migrate — DO NOT EDIT\n` +
      `// provenance:\n` +
      `//   source:    ${ir.module.source.file} (sha256 ${ir.module.source.sha256.slice(0, 16)}…)\n` +
      `//   program:   ${ir.module.programId} (ir ${ir.irVersion})\n` +
      `//   model:     ${completion.model} (cache ${completion.cacheKey.slice(0, 16)}…)\n` +
      `//   candidate: ${cand.id} (${cand.label})\n`;

    const candDir = resolve(opts.outDir, `candidate-${cand.id}`);
    mkdirSync(candDir, { recursive: true });
    const javaPath = join(candDir, `${emittedClass}.java`);
    writeFileSync(javaPath, header + java);
    outcome.javaFile = javaPath.replace(/\\/g, "/");

    const javac = spawnSync("javac", ["--release", "21", `${emittedClass}.java`], {
      cwd: candDir,
      encoding: "utf8",
      windowsHide: true,
    });
    outcome.compile = {
      ok: javac.status === 0 && !javac.error,
      output: (javac.stderr ?? "") + (javac.error ? String(javac.error) : ""),
    };
    if (!outcome.compile.ok) {
      console.log(`  candidate ${cand.id}: COMPILE FAILED — rejected`);
      for (const line of outcome.compile.output.split(/\r?\n/).slice(0, 8)) {
        if (line.trim()) console.log(`        ${line}`);
      }
      continue;
    }

    // --- 4: verify (layer B on the selection cases) ---------------------------
    const candConfig: DiffConfig = {
      ...diffConfig,
      modern: { argv: ["java", "-cp", candDir, emittedClass], label: `candidate ${cand.id} (${cand.label})` },
    };
    const { results, summary, verdict } = runDiffCases(candConfig, diffBaseDir, cases);
    outcome.verify = { ...summary, verdict };
    console.log(`  candidate ${cand.id}: compiled; verify ${verdict} (${summary.passed}/${summary.total} passed)`);
    if (verdict === "FAIL") printCaseResults(results.filter((r) => r.status !== "PASS"));

    writeFileSync(
      join(opts.outDir, `candidate-${cand.id}.diff-report.json`),
      JSON.stringify({ candidate: cand.id, verdict, summary, cases: results }, null, 2) + "\n",
    );

    // Layer A gate: a candidate that beats the curated cases must also
    // survive generated inputs before it can win. Prevents overfitting a
    // small selection suite.
    if (opts.propConfigPath && verdict === "PASS") {
      const propConfig = loadConfig(opts.propConfigPath);
      const propBaseDir = dirname(resolve(opts.propConfigPath));
      const { fields, count, seed } = resolveGenerator(propConfig, propBaseDir, {});
      const genCases = generateCases(fields, count, seed);
      const propCandConfig: DiffConfig = {
        ...propConfig,
        modern: { argv: ["java", "-cp", candDir, emittedClass], label: `candidate ${cand.id} (${cand.label})` },
      };
      const prop = runDiffCases(propCandConfig, propBaseDir, genCases);
      outcome.propVerify = { ...prop.summary, verdict: prop.verdict, seed, count };
      console.log(
        `  candidate ${cand.id}: layer A gate ${prop.verdict} ` +
          `(${prop.summary.passed}/${prop.summary.total} generated cases, seed=${seed})`,
      );
      if (prop.verdict === "FAIL") printCaseResults(prop.results.filter((r) => r.status !== "PASS").slice(0, 3));
    }
  }

  const winner =
    outcomes.find(
      (o) =>
        o.compile.ok &&
        o.verify?.verdict === "PASS" &&
        (!opts.propConfigPath || o.propVerify?.verdict === "PASS"),
    ) ?? null;

  const totalCost = outcomes.reduce((s, o) => s + (o.costUsd ?? 0), 0);
  const selection = {
    tool: "legacymind migrate",
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    module: { programId: ir.module.programId, source: ir.module.source },
    model: opts.model,
    selectionCases: { config: resolve(opts.diffConfigPath).replace(/\\/g, "/"), count: cases.length },
    propGate: opts.propConfigPath ? resolve(opts.propConfigPath).replace(/\\/g, "/") : null,
    candidates: outcomes,
    winner: winner ? { id: winner.id, label: winner.label, javaFile: winner.javaFile } : null,
    totalCostUsd: totalCost,
  };
  mkdirSync(resolve(opts.outDir), { recursive: true });
  const selectionPath = join(opts.outDir, "selection.json");
  writeFileSync(selectionPath, JSON.stringify(selection, null, 2) + "\n");

  console.log("");
  if (winner) {
    console.log(`  winner: candidate ${winner.id} (${winner.label}) -> ${winner.javaFile}`);
  } else {
    console.log(`  winner: NONE — no candidate passed verification. This module is NOT migrated.`);
  }
  console.log(`  session cost: $${totalCost.toFixed(4)} (cached replays are free)`);
  console.log(`  selection report: ${selectionPath}`);
  return winner ? 0 : 1;
}
