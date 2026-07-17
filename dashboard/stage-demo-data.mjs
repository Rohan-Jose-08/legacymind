// Stage a clean demo data directory for the dashboard: exactly the 27
// signed module certificates, nothing else.
//
// LEGACYMIND_DATA_DIR can point straight at the pipeline's ../out, but
// that directory also accumulates stale/first-run artifacts (early
// content-hash-only certs, negative-test fixtures) that render as
// confusing "unsigned" rows in a customer demo. This copies only the
// certCopy set named in benchmark/modules.json — the canonical 27 — into
// dashboard/demo-data/, verifying each signature as it goes so the
// snapshot is provably the real, signed set. Certificates are copied
// byte-for-byte; their embedded evidence paths (and therefore signatures)
// are untouched.
//
//   node dashboard/stage-demo-data.mjs
//   # then point the dashboard at it:
//   LEGACYMIND_DATA_DIR=./demo-data npm run dev   (from dashboard/)
//
// Note: evidence-download links resolve embedded absolute report paths,
// which only match on the machine that produced them; the core dashboard
// (verdicts, signatures, coverage, gaps, cost) reads solely from the
// certificate JSON and is host-independent.

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = path.join(ROOT, "out");
const DEST = path.join(HERE, "demo-data");
const TRUSTED_KEY = path.join(ROOT, "keys", "legacymind-dev-ed25519.pub.pem");

function canonicalize(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonicalize(v[k])).join(",") + "}";
}
function keyIdOf(pub) {
  return createHash("sha256").update(pub.export({ format: "der", type: "spki" })).digest("hex").slice(0, 16);
}

const trustedPub = existsSync(TRUSTED_KEY) ? createPublicKey(readFileSync(TRUSTED_KEY)) : null;
const trustedId = trustedPub ? keyIdOf(trustedPub) : null;
if (!trustedPub) {
  console.error(`trusted key not found at ${TRUSTED_KEY} — cannot verify signatures`);
  process.exit(1);
}

const modules = JSON.parse(readFileSync(path.join(ROOT, "benchmark", "modules.json"), "utf8"));

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

let staged = 0;
const problems = [];
for (const m of modules) {
  const src = path.join(ROOT, m.certCopy);
  if (!existsSync(src)) { problems.push(`${m.id}: ${m.certCopy} missing`); continue; }
  const raw = readFileSync(src, "utf8");
  const cert = JSON.parse(raw);
  if (cert.tool !== "legacymind certify" || cert.verdict !== "CERTIFIED") {
    problems.push(`${m.id}: not a CERTIFIED certify artifact`); continue;
  }
  const { integrity, ...body } = cert;
  if (!integrity || integrity.algorithm !== "ed25519") { problems.push(`${m.id}: unsigned`); continue; }
  const pub = createPublicKey(integrity.publicKey);
  const sigOk = edVerify(null, Buffer.from(canonicalize(body), "utf8"), pub, Buffer.from(integrity.signature, "base64"));
  const trusted = trustedPub.export({ format: "der", type: "spki" }).equals(pub.export({ format: "der", type: "spki" }));
  if (!sigOk) { problems.push(`${m.id}: SIGNATURE INVALID`); continue; }
  if (!trusted) { problems.push(`${m.id}: untrusted key ${keyIdOf(pub)}`); continue; }
  writeFileSync(path.join(DEST, path.basename(m.certCopy)), raw);
  staged++;
}

console.log(`staged ${staged}/${modules.length} signed certificates into ${path.relative(ROOT, DEST)}/`);
console.log(`trusted signer: ${trustedId}`);
if (problems.length) {
  console.error("PROBLEMS:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("all staged certificates: signature valid + signer trusted");
