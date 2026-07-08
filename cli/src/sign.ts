/**
 * Certificate signing and verification (Ed25519).
 *
 * A LegacyMind certificate is the artifact we sell, so it must be
 * tamper-evident and attributable. Every certificate carries an
 * `integrity` block: an Ed25519 signature over the *canonical* form of
 * the certificate body (the whole document minus the integrity block
 * itself), plus the signer's public key and a content hash.
 *
 * Canonicalization sorts object keys recursively, so verification never
 * depends on JSON serialization order — a certificate can be re-pretty-
 * printed and still verify, but changing any value breaks the signature.
 *
 * Trust model: the signature proves the body was not modified after
 * signing (integrity). Pinning the public key against a trusted key
 * proves *who* signed it (provenance) — `verify-cert` does both. The demo
 * key ships in `keys/`; production passes a KMS-held key via
 * `--signing-key`. See keys/README.md.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class SignError extends Error {}

/** PKCS#8 DER prefix for an Ed25519 private key; a 32-byte seed follows. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** cli/dist/sign.js -> <repo>/keys */
function repoKeysDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "keys");
}

/**
 * Deterministic string form of a JSON value with object keys sorted
 * recursively. Independent of insertion/serialization order.
 */
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

export function keyIdOf(pub: KeyObject): string {
  const spki = pub.export({ format: "der", type: "spki" });
  return createHash("sha256").update(spki).digest("hex").slice(0, 16);
}

function samePublicKey(a: KeyObject, b: KeyObject): boolean {
  return (a.export({ format: "der", type: "spki" }) as Buffer).equals(
    b.export({ format: "der", type: "spki" }) as Buffer,
  );
}

export interface SigningKey {
  priv: KeyObject;
  pub: KeyObject;
  /** Human-readable provenance of the key (for logs), not embedded. */
  source: string;
}

/**
 * Load the signing key: an explicit PEM private key (production), or the
 * committed demo seed (default). `keyPath` also accepts the
 * LEGACYMIND_SIGNING_KEY env var when passed through from the CLI.
 */
export function loadSigningKey(keyPath?: string): SigningKey {
  if (keyPath) {
    let pem: Buffer;
    try {
      pem = readFileSync(keyPath);
    } catch (e) {
      throw new SignError(`cannot read signing key ${keyPath}: ${(e as Error).message}`);
    }
    let priv: KeyObject;
    try {
      priv = createPrivateKey(pem);
    } catch (e) {
      throw new SignError(`signing key ${keyPath} is not a valid PEM private key: ${(e as Error).message}`);
    }
    if (priv.asymmetricKeyType !== "ed25519") {
      throw new SignError(`signing key ${keyPath} is ${priv.asymmetricKeyType}, expected ed25519`);
    }
    return { priv, pub: createPublicKey(priv), source: keyPath };
  }
  const seedPath = join(repoKeysDir(), "legacymind-dev-ed25519.seed");
  let seedHex: string;
  try {
    seedHex = readFileSync(seedPath, "utf8").trim();
  } catch (e) {
    throw new SignError(
      `no signing key given and the demo seed is missing at ${seedPath}: ${(e as Error).message}`,
    );
  }
  if (!/^[0-9a-f]{64}$/.test(seedHex)) {
    throw new SignError(`demo seed at ${seedPath} must be 64 hex characters (a 32-byte Ed25519 seed)`);
  }
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedHex, "hex")]);
  const priv = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return { priv, pub: createPublicKey(priv), source: "keys/legacymind-dev-ed25519.seed (DEMO KEY)" };
}

export interface Integrity {
  algorithm: "ed25519";
  keyId: string;
  publicKey: string;
  canonicalization: "json-sorted-keys";
  contentSha256: string;
  signature: string;
  note: string;
}

/** Produce the integrity block for a certificate body. */
export function signBody(body: unknown, keyPath?: string): { integrity: Integrity; source: string } {
  const { priv, pub, source } = loadSigningKey(keyPath);
  const canon = Buffer.from(canonicalize(body), "utf8");
  return {
    integrity: {
      algorithm: "ed25519",
      keyId: keyIdOf(pub),
      publicKey: (pub.export({ format: "pem", type: "spki" }) as string).trim(),
      canonicalization: "json-sorted-keys",
      contentSha256: createHash("sha256").update(canon).digest("hex"),
      signature: (edSign(null, canon, priv) as Buffer).toString("base64"),
      note: "Ed25519 signature over the canonical certificate body (this field excluded). Check with `legacymind verify-cert`.",
    },
    source,
  };
}

export interface TrustedKey {
  pub: KeyObject;
  keyId: string;
  source: string;
}

export function loadTrustedKey(trustedPath?: string): TrustedKey | null {
  const p = trustedPath ?? join(repoKeysDir(), "legacymind-dev-ed25519.pub.pem");
  if (!existsSync(p)) return null;
  const pub = createPublicKey(readFileSync(p));
  return { pub, keyId: keyIdOf(pub), source: p };
}

export interface VerifyResult {
  ok: boolean;
  signatureValid: boolean;
  contentHashValid: boolean;
  /** true trusted / false untrusted / null no trusted key available. */
  keyTrusted: boolean | null;
  keyId: string;
  trustedKeyId: string | null;
  reasons: string[];
}

/**
 * Verify a certificate's integrity block. `ok` is true only when the
 * signature is valid, the content hash matches, and the signer is the
 * trusted key (when one is available to pin against).
 */
export function verifyCertificate(cert: unknown, trustedPath?: string): VerifyResult {
  const reasons: string[] = [];
  if (cert === null || typeof cert !== "object") {
    return blank(reasons, "not a certificate object");
  }
  const { integrity, ...body } = cert as Record<string, unknown> & { integrity?: Integrity };
  if (!integrity || typeof integrity !== "object") {
    return blank(reasons, "certificate has no integrity block (unsigned)");
  }
  if (integrity.algorithm !== "ed25519") {
    return blank(reasons, `unsupported integrity algorithm "${integrity.algorithm}" (expected ed25519)`);
  }
  if (typeof integrity.publicKey !== "string" || typeof integrity.signature !== "string") {
    return blank(reasons, "integrity block is missing its publicKey or signature");
  }

  let embeddedPub: KeyObject;
  try {
    embeddedPub = createPublicKey(integrity.publicKey);
  } catch (e) {
    return blank(reasons, `embedded public key is unreadable: ${(e as Error).message}`);
  }
  const embeddedKeyId = keyIdOf(embeddedPub);
  const canon = Buffer.from(canonicalize(body), "utf8");

  let signatureValid = false;
  try {
    signatureValid = edVerify(null, canon, embeddedPub, Buffer.from(integrity.signature, "base64"));
  } catch (e) {
    reasons.push(`signature could not be checked: ${(e as Error).message}`);
  }
  if (!signatureValid) {
    reasons.push("SIGNATURE INVALID — the certificate body does not match its signature (tampered or corrupted)");
  }

  const contentHashValid =
    createHash("sha256").update(canon).digest("hex") === integrity.contentSha256;
  if (!contentHashValid) reasons.push("content hash does not match the canonical body");

  const trusted = loadTrustedKey(trustedPath);
  let keyTrusted: boolean | null = null;
  if (trusted) {
    keyTrusted = samePublicKey(trusted.pub, embeddedPub);
    if (!keyTrusted) {
      reasons.push(
        `signer key ${embeddedKeyId} is not the trusted key ${trusted.keyId} — unknown signer (provenance fails)`,
      );
    }
  } else {
    reasons.push("no trusted public key available; signature integrity checked but provenance unverified");
  }

  const ok = signatureValid && contentHashValid && keyTrusted !== false;
  return {
    ok,
    signatureValid,
    contentHashValid,
    keyTrusted,
    keyId: embeddedKeyId,
    trustedKeyId: trusted?.keyId ?? null,
    reasons,
  };
}

function blank(reasons: string[], reason: string): VerifyResult {
  reasons.push(reason);
  return {
    ok: false,
    signatureValid: false,
    contentHashValid: false,
    keyTrusted: null,
    keyId: "n/a",
    trustedKeyId: null,
    reasons,
  };
}
