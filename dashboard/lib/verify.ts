/**
 * Server-side certificate signature verification.
 *
 * The dashboard renders certificates the CLI produced; without checking
 * the signature it could not tell a tampered certificate from a genuine
 * one. This verifies the Ed25519 signature (integrity) and pins the
 * signer's public key against the trusted key (provenance) — the same
 * two checks `legacymind verify-cert` runs, so the UI badge and the CLI
 * agree. The algorithm mirrors cli/src/sign.ts exactly (canonical form
 * = JSON with recursively sorted keys), so a certificate signed by the
 * CLI verifies here byte-for-byte.
 *
 * Runs only on the server (node:crypto + fs); imported by server
 * components and lib/data.ts.
 */

import { createHash, createPublicKey, verify as edVerify, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Integrity {
  algorithm: string;
  keyId?: string;
  publicKey?: string;
  canonicalization?: string;
  contentSha256?: string;
  signature?: string;
  hash?: string; // legacy content-hash-only certificates
  note?: string;
}

export interface SignatureStatus {
  /** The certificate carries an Ed25519 signature block. */
  present: boolean;
  signatureValid: boolean;
  /** true trusted / false untrusted / null no trusted key available. */
  keyTrusted: boolean | null;
  keyId: string;
  trustedKeyId: string | null;
  /** Overall: signature valid and (if a trusted key exists) the signer is trusted. */
  ok: boolean;
  reason: string;
}

/** Canonical form: JSON with object keys sorted recursively (order-independent). */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const obj = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
      .join(",") +
    "}"
  );
}

function keyIdOf(pub: KeyObject): string {
  const spki = pub.export({ format: "der", type: "spki" }) as Buffer;
  return createHash("sha256").update(spki).digest("hex").slice(0, 16);
}

function trustedKeyPath(): string {
  return (
    process.env.LEGACYMIND_TRUSTED_KEY ??
    path.resolve(process.cwd(), "../keys/legacymind-dev-ed25519.pub.pem")
  );
}

let trustedCache: { pub: KeyObject; keyId: string } | null | undefined;
function loadTrustedKey(): { pub: KeyObject; keyId: string } | null {
  if (trustedCache !== undefined) return trustedCache;
  const p = trustedKeyPath();
  if (!existsSync(p)) {
    trustedCache = null;
    return null;
  }
  try {
    const pub = createPublicKey(readFileSync(p));
    trustedCache = { pub, keyId: keyIdOf(pub) };
  } catch {
    trustedCache = null;
  }
  return trustedCache;
}

/** Verify a certificate's Ed25519 signature and check the signer is trusted. */
export function verifyCertSignature(cert: unknown): SignatureStatus {
  const blank = (reason: string): SignatureStatus => ({
    present: false,
    signatureValid: false,
    keyTrusted: null,
    keyId: "n/a",
    trustedKeyId: loadTrustedKey()?.keyId ?? null,
    ok: false,
    reason,
  });

  if (cert === null || typeof cert !== "object") return blank("not a certificate");
  const { integrity, ...body } = cert as Record<string, unknown> & { integrity?: Integrity };
  if (!integrity || typeof integrity !== "object" || integrity.algorithm !== "ed25519") {
    return blank(
      integrity && (integrity as Integrity).hash
        ? "unsigned: legacy content-hash only, not a cryptographic signature"
        : "unsigned certificate",
    );
  }
  if (typeof integrity.publicKey !== "string" || typeof integrity.signature !== "string") {
    return blank("signature block is missing its public key or signature");
  }

  let embeddedPub: KeyObject;
  try {
    embeddedPub = createPublicKey(integrity.publicKey);
  } catch {
    return blank("embedded public key is unreadable");
  }
  const keyId = keyIdOf(embeddedPub);
  const canon = Buffer.from(canonicalize(body), "utf8");

  let signatureValid = false;
  try {
    signatureValid = edVerify(null, canon, embeddedPub, Buffer.from(integrity.signature, "base64"));
  } catch {
    signatureValid = false;
  }

  const trusted = loadTrustedKey();
  let keyTrusted: boolean | null = null;
  if (trusted) {
    keyTrusted = (trusted.pub.export({ format: "der", type: "spki" }) as Buffer).equals(
      embeddedPub.export({ format: "der", type: "spki" }) as Buffer,
    );
  }

  const ok = signatureValid && keyTrusted !== false;
  const reason = !signatureValid
    ? "SIGNATURE INVALID — the certificate was modified after signing"
    : keyTrusted === false
      ? `signed by an untrusted key ${keyId} (trusted is ${trusted?.keyId})`
      : keyTrusted === null
        ? "signature valid; no trusted key configured to check provenance"
        : "signature valid and signer trusted";

  return {
    present: true,
    signatureValid,
    keyTrusted,
    keyId,
    trustedKeyId: trusted?.keyId ?? null,
    ok,
    reason,
  };
}
