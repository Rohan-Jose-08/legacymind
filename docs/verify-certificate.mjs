// Independent LegacyMind certificate verifier — Node built-ins only.
// Usage: node independent-verify.mjs <certificate.json> [expected-key-id]
import { readFileSync } from "node:fs";
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

const cert = JSON.parse(readFileSync(process.argv[2], "utf8"));
const expectedKeyId = process.argv[3]; // optional: pin provenance

// 1. Canonical form: JSON with object keys sorted recursively, integrity omitted.
function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
const { integrity, ...body } = cert;
const canonicalBytes = Buffer.from(canon(body), "utf8");

// 2. Integrity: signature over the canonical body, and the content hash.
const pub = createPublicKey(integrity.publicKey);
const sigValid = edVerify(null, canonicalBytes, pub, Buffer.from(integrity.signature, "base64"));
const hashValid = createHash("sha256").update(canonicalBytes).digest("hex") === integrity.contentSha256;

// 3. Provenance: the signer's key id = first 16 hex of SHA-256 of its SPKI DER.
const keyId = createHash("sha256").update(pub.export({ format: "der", type: "spki" })).digest("hex").slice(0, 16);
const keyTrusted = expectedKeyId ? keyId === expectedKeyId : "(no expected key id given)";

console.log("signature valid:", sigValid);
console.log("content hash matches:", hashValid);
console.log("signer key id:", keyId, "| trusted:", keyTrusted);
console.log("verdict in cert:", cert.verdict);
process.exit(sigValid && hashValid && keyTrusted !== false ? 0 : 1);
