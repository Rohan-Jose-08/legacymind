// LegacyMind benchmark runner: for every module in modules.json, run the
// full pipeline (parse -> harness image -> migrate -> layers A + C ->
// certify) against the REAL GnuCOBOL binary, then write RESULTS.md and
// results.json. A module failure is recorded and the run continues — the
// benchmark reports failures, it does not hide them.
//
// Usage (from the legacymind repo root, cache pre-recorded, Docker up):
//   node benchmark/run-benchmark.mjs [--skip-images] [--engine proleap|stub]
//
// The default parse engine is proleap (the production ANTLR4 grammar);
// both engines are cross-validated to emit identical IR for these
// modules, so the committed transpiler replay cache serves either.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SKIP_IMAGES = process.argv.includes("--skip-images");
const ENGINE = process.argv.includes("--engine")
  ? process.argv[process.argv.indexOf("--engine") + 1]
  : "proleap";
const modules = JSON.parse(readFileSync(join(ROOT, "benchmark/modules.json"), "utf8"));

const run = (argv, label) => {
  const started = Date.now();
  const res = spawnSync(argv[0], argv.slice(1), { cwd: ROOT, encoding: "utf8", windowsHide: true });
  const ms = Date.now() - started;
  const ok = res.status === 0 && !res.error;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label} (${(ms / 1000).toFixed(1)}s)`);
  if (!ok) {
    for (const line of ((res.stdout ?? "") + (res.stderr ?? "")).split(/\r?\n/).slice(-12)) {
      if (line.trim()) console.log(`       ${line}`);
    }
  }
  return { ok, ms };
};

const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const rows = [];
for (const m of modules) {
  console.log(`\n=== ${m.programId} (${m.source}) ===`);
  const started = Date.now();
  const benchDir = `out/bench/${m.id}`;
  mkdirSync(join(ROOT, benchDir), { recursive: true });
  const propOut = `${benchDir}/property-report.json`;
  const symOut = `${benchDir}/symexec-report.json`;
  const staticOut = `${benchDir}/staticflow-report.json`;
  const certOut = `${benchDir}/certification.json`;
  // Remove stale artifacts from prior runs BEFORE any step executes: a
  // failed step must surface as PIPELINE-FAILED, never as last run's
  // leftover verdict — and never delete what this run just produced.
  for (const p of [propOut, symOut, staticOut, certOut, `${m.migrateOut}/selection.json`]) {
    rmSync(join(ROOT, p), { force: true });
  }
  const steps = { parse: null, image: null, migrate: null, layerA: null, layerC: null, layerD: null, certify: null, verifyCert: null };

  steps.parse = run(
    ["node", "cli/dist/main.js", "parse", m.source, "--out", "out/ir/", "--engine", ENGINE],
    `parse (${ENGINE} engine)`,
  );
  if (!SKIP_IMAGES) {
    steps.image = run(
      ["docker", "build", "-f", "harness/gnucobol/Dockerfile", "--build-arg", `SOURCE=${m.source}`, "-t", m.imageTag, "."],
      `harness image ${m.imageTag}`,
    );
  }
  steps.migrate = run(
    ["node", "cli/dist/main.js", "migrate", `out/ir/${m.programId}.ir.json`,
      "--diff-config", m.diffConfig, "--out", m.migrateOut, "--offline"],
    "migrate (layer B selection vs real binary)",
  );
  steps.layerA = run(
    ["node", "cli/dist/main.js", "verify", "--layer", "A", "--config", m.propConfig, "--out", propOut],
    "verify layer A (vs real binary)",
  );
  steps.layerC = run(
    ["node", "cli/dist/main.js", "verify", "--layer", "C", "--config", m.symConfig, "--out", symOut],
    "verify layer C (vs real binary)",
  );
  steps.layerD = run(
    ["node", "cli/dist/main.js", "verify", "--layer", "D", "--config", m.staticConfig, "--out", staticOut],
    "verify layer D (static, no execution)",
  );
  steps.certify = run(
    ["node", "cli/dist/main.js", "certify", "--selection", `${m.migrateOut}/selection.json`,
      "--layer-a", propOut, "--layer-c", symOut, "--layer-d", staticOut, "--out", certOut],
    "certify",
  );
  run(["node", "cli/dist/main.js", "report", certOut, "--out", `${benchDir}/certification.md`], "report");
  // Prove the certificate is signed and tamper-evident against the trusted
  // key — every run re-verifies the artifact it just produced.
  steps.verifyCert = run(["node", "cli/dist/main.js", "verify-cert", certOut], "verify-cert (Ed25519 signature)");
  if (existsSync(join(ROOT, certOut))) copyFileSync(join(ROOT, certOut), join(ROOT, m.certCopy));

  // gather the row from the artifacts themselves
  const row = {
    id: m.id,
    programId: m.programId,
    source: m.source,
    loc: readFileSync(join(ROOT, m.source), "utf8").split(/\r?\n/).filter((l) => l.trim()).length,
    wallSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    steps: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, v ? v.ok : "skipped"])),
    verdict: "PIPELINE-FAILED",
  };
  try {
    const selection = readJson(`${m.migrateOut}/selection.json`);
    const cert = readJson(certOut);
    const prop = readJson(propOut);
    const sym = readJson(symOut);
    const stat = readJson(staticOut);
    row.winner = selection.winner?.id ?? null;
    row.candidates = selection.candidates?.length ?? null;
    row.costUsd = selection.totalCostUsd ?? null;
    row.layerB = cert.coverageEnvelope?.layerB ?? null;
    row.layerA = { passed: prop.summary?.passed, generated: prop.summary?.generated, seed: prop.generator?.seed };
    row.layerC = { obligations: sym.summary?.obligations, paths: sym.summary?.paths };
    row.layerD = { keys: stat.summary?.keys, capacityWarnings: stat.summary?.capacityWarnings };
    row.gaps = cert.coverageEnvelope?.gaps ?? [];
    row.verdict = cert.verdict;
    row.signature = {
      algorithm: cert.integrity?.algorithm ?? null,
      keyId: cert.integrity?.keyId ?? null,
      verified: steps.verifyCert?.ok ?? false,
    };
  } catch (e) {
    row.error = `artifact collection failed: ${e.message}`;
  }
  rows.push(row);
}

// --- results.json ------------------------------------------------------------
const results = {
  tool: "legacymind benchmark",
  version: "0.1.0",
  generatedAt: new Date().toISOString(),
  toolchain: {
    parser:
      ENGINE === "proleap"
        ? "proleap engine (ProLeap ANTLR4 COBOL85 grammar + reference-format preprocessor, JVM)"
        : "stub engine (bounded fixed-format subset, TypeScript)",
    legacy: "GnuCOBOL 3.1.2 (debian:bookworm-slim, sandboxed: --network none, --rm)",
    modern: "Java 21 (javac --release 21), executed on host",
    transpiler: "claude-opus-4-8 via recorded replay cache (offline)",
  },
  modules: rows,
};
writeFileSync(join(ROOT, "benchmark/results.json"), JSON.stringify(results, null, 2) + "\n");

// --- RESULTS.md ---------------------------------------------------------------
const lines = [];
lines.push("# LegacyMind benchmark results");
lines.push("");
lines.push(`Generated ${results.generatedAt} by \`node benchmark/run-benchmark.mjs\`.`);
lines.push("");
lines.push("Every module below was parsed to IR, migrated to Java 21 by the");
lines.push("transpiler (two prompt-variant candidates, replayed from the committed");
lines.push("cache), and verified **against the real GnuCOBOL 3.1.2 binary running");
lines.push("sandboxed in Docker** — no mocks anywhere in this table. CERTIFIED");
lines.push("means layer B plus every other run layer (A, C, D) passed on the");
lines.push("selected candidate; every disclosed gap is listed in the certificate.");
lines.push("Each certificate is Ed25519-signed and re-verified against the trusted");
lines.push("key in the same run — the **Signed** column is that check, so a");
lines.push("tampered or wrongly-signed certificate would fail the benchmark.");
lines.push("");
lines.push("| Module | COBOL lines | Winner | Layer B | Layer A (seeded) | Layer C obligations | Paths | Layer D keys | Verdict | Signed | LLM cost | Wall time |");
lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const b = r.layerB ? `${r.layerB.curatedCases} cases` : "—";
  const a = r.layerA ? `${r.layerA.passed}/${r.layerA.generated} (seed ${r.layerA.seed})` : "—";
  const o = r.layerC?.obligations
    ? `${r.layerC.obligations.verified}✓ ${r.layerC.obligations.divergent}✗ ${r.layerC.obligations.unrealized} unrealized`
    : "—";
  const p = r.layerC?.paths
    ? `${r.layerC.paths.covered}/${r.layerC.paths.total - (r.layerC.paths.infeasible ?? 0)}` +
      ((r.layerC.paths.infeasible ?? 0) > 0 ? ` (+${r.layerC.paths.infeasible} dead)` : "")
    : "—";
  const d = r.layerD?.keys
    ? `${r.layerD.keys.verified}/${r.layerD.keys.total} static` +
      (r.layerD.capacityWarnings ? ` (${r.layerD.capacityWarnings} warn)` : "")
    : "—";
  const sig = r.signature?.verified ? `✓ \`${r.signature.keyId}\`` : "✗";
  lines.push(
    `| ${r.programId} | ${r.loc} | candidate ${r.winner ?? "—"} of ${r.candidates ?? "—"} | ${b} | ${a} | ${o} | ${p} | ${d} | **${r.verdict}** | ${sig} | $${(r.costUsd ?? 0).toFixed(4)} | ${r.wallSeconds}s |`,
  );
}
lines.push("");
lines.push("## Disclosed gaps per certificate");
lines.push("");
for (const r of rows) {
  lines.push(`**${r.programId}**`);
  for (const g of r.gaps ?? []) lines.push(`- ${g}`);
  lines.push("");
}

// --- external corpus parse coverage (if the sweep has been run) ---------------
const coveragePath = join(ROOT, "benchmark/parse-coverage.json");
if (existsSync(coveragePath)) {
  const cov = JSON.parse(readFileSync(coveragePath, "utf8"));
  const pct = (n) => ((100 * n) / cov.total).toFixed(1);
  lines.push("## Parser coverage against an external corpus");
  lines.push("");
  lines.push(`Corpus: ${cov.corpus} (${cov.commit ? `commit ${cov.commit.slice(0, 12)}` : "unpinned"}), ${cov.total} files.`);
  lines.push("");
  lines.push("| Engine | Tier | Files | Rate |");
  lines.push("|---|---|---|---|");
  lines.push(`| stub | parsed | ${cov.stub.parsed} | ${pct(cov.stub.parsed)}% |`);
  lines.push(`| proleap | front-end accepted (grammar + preprocessor) | ${cov.proleap.frontendAccepted} | ${pct(cov.proleap.frontendAccepted)}% |`);
  lines.push(`| proleap | IR-complete (every construct lowered) | ${cov.proleap.irComplete} | ${pct(cov.proleap.irComplete)}% |`);
  lines.push("");
  lines.push("Front-end acceptance is what the production grammar and its");
  lines.push("reference-format preprocessor handle; IR-complete is the stricter");
  lines.push("tier the rest of the pipeline consumes today. Files in between");
  lines.push("parse fine but use constructs the IR lowering does not model yet —");
  lines.push("every one is enumerated per file, never skipped silently, and the");
  lines.push("histogram below is the prioritized lowering backlog.");
  lines.push("");
  lines.push("| Construct outside the IR subset | Occurrences |");
  lines.push("|---|---|");
  for (const r of cov.proleap.topUnsupportedConstructs.slice(0, 15)) lines.push(`| ${r.reason} | ${r.count} |`);
  lines.push("");
}

lines.push("## Reproduction");
lines.push("");
lines.push("```");
lines.push("cd legacymind");
lines.push("npm --prefix cli install && npm --prefix cli run build");
lines.push("node benchmark/run-benchmark.mjs            # requires Docker");
lines.push("node benchmark/parse-sweep.mjs <corpus-dir> # optional external sweep");
lines.push("```");
lines.push("");
lines.push("Candidates replay from `transpiler/cache/` (committed), so the run is");
lines.push("offline and deterministic; layer A seeds are fixed and recorded in each");
lines.push("report. Certificates and layer reports land in `out/bench/<module>/`.");
lines.push("");
writeFileSync(join(ROOT, "benchmark/RESULTS.md"), lines.join("\n"));

const certifiedCount = rows.filter((r) => r.verdict === "CERTIFIED").length;
const signedCount = rows.filter((r) => r.signature?.verified).length;
console.log(`\nbenchmark complete: ${certifiedCount}/${rows.length} modules certified, ${signedCount}/${rows.length} signatures verified`);
console.log("  benchmark/RESULTS.md");
console.log("  benchmark/results.json");
process.exit(rows.every((r) => r.verdict === "CERTIFIED" && r.signature?.verified) ? 0 : 1);
