#!/usr/bin/env node
/**
 * Re-sign every benchmark certificate with a PRODUCTION key and stage the
 * result for a remote deploy.
 *
 * The committed demo key exists so the benchmark signs reproducibly and
 * offline (keys/README.md), which is a feature — but a customer-facing
 * dashboard pins a real public key, and a demo-signed certificate shown
 * there reads as "untrusted signer", correctly.
 *
 * This does NOT re-verify anything and does not change a single claim. It
 * re-runs `certify` over the layer reports each module already produced,
 * so the evidence, the hashes and the gaps are identical; only the
 * signature differs. Any module whose reports are missing is skipped
 * LOUDLY and named — a certificate quietly absent from the dashboard is
 * exactly the kind of hole this project refuses.
 *
 *   node resign-demo-data.mjs --signing-key <prod.pem> [--out demo-data]
 *                             [--extra <dir-of-certification-*.json>]
 *
 * `--extra` folds in certificates produced outside the benchmark (the real
 * CardDemo audits), re-signing them the same way when their inputs are
 * alongside, or copying them byte-for-byte when they are already signed by
 * the target key.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const signingKey = arg("signing-key", null);
if (!signingKey) {
  console.error("resign-demo-data: --signing-key <prod.pem> is required");
  process.exit(2);
}
const outDir = resolve(HERE, arg("out", "demo-data"));
const extraDir = arg("extra", null);

const modules = JSON.parse(readFileSync(join(ROOT, "benchmark/modules.json"), "utf8"));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const cli = join(ROOT, "cli/dist/main.js");
const skipped = [];
let signed = 0;

for (const m of modules) {
  const bench = join(ROOT, "out/bench", m.id);
  const selection = join(ROOT, m.migrateOut, "selection.json");
  const need = {
    selection,
    "layer A": join(bench, "property-report.json"),
    "layer C": join(bench, "symexec-report.json"),
    "layer D": join(bench, "staticflow-report.json"),
    toolchain: join(bench, "toolchain.json"),
    ir: join(ROOT, `out/ir/${m.programId}.ir.json`),
  };
  const missing = Object.entries(need).filter(([, p]) => !existsSync(p)).map(([k]) => k);
  if (missing.length) {
    skipped.push(`${m.programId}: missing ${missing.join(", ")}`);
    continue;
  }
  const out = join(outDir, `certification-${m.id}.json`);
  try {
    execFileSync(
      "node",
      [cli, "certify",
        "--selection", need.selection,
        "--layer-a", need["layer A"],
        "--layer-c", need["layer C"],
        "--layer-d", need["layer D"],
        "--toolchain", need.toolchain,
        "--ir", need.ir,
        "--signing-key", signingKey,
        "--out", out],
      { cwd: ROOT, stdio: "pipe" },
    );
    signed++;
  } catch (e) {
    skipped.push(`${m.programId}: certify failed — ${String(e.stderr ?? e).slice(0, 200)}`);
  }
}

// Extra certificates (the real third-party audits) are copied byte-for-byte:
// they were produced by `certify --audit-java` and re-signing them here would
// need their supplied artifact and layer reports, which live outside the repo.
let copied = 0;
if (extraDir) {
  const dir = resolve(extraDir);
  for (const f of readdirSync(dir).filter((n) => /^certification-.*\.json$/.test(n))) {
    copyFileSync(join(dir, f), join(outDir, f));
    copied++;
  }
}

// Every staged certificate must verify against the key we just signed with —
// including the copied ones, which is how a stale demo-signed artifact gets
// caught before it reaches the dashboard.
const pub = signingKey.replace(/\.pem$/, ".pub.pem");
const trusted = existsSync(pub) ? pub : join(HERE, "legacymind-prod-ed25519.pub.pem");
const bad = [];
for (const f of readdirSync(outDir)) {
  try {
    execFileSync("node", [cli, "verify-cert", join(outDir, f), "--trusted-key", trusted], { cwd: ROOT, stdio: "pipe" });
  } catch {
    bad.push(f);
  }
}

console.log(`resign-demo-data: ${signed} benchmark + ${copied} external certificate(s) staged in ${outDir}`);
if (skipped.length) {
  console.log(`  SKIPPED (${skipped.length}) — these will NOT appear in the dashboard:`);
  for (const s of skipped) console.log(`    - ${s}`);
}
if (bad.length) {
  console.error(`  FAILED VERIFICATION against ${basename(trusted)} (${bad.length}):`);
  for (const b of bad) console.error(`    - ${b}`);
  process.exit(1);
}
console.log(`  all staged certificates verify against ${basename(trusted)}`);
