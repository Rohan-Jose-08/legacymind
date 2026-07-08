# keys/ — certificate signing material

LegacyMind signs every `certification.json` with an Ed25519 key so the
certificate is **tamper-evident** (any edit breaks the signature) and
**attributable** (verifiers pin the signer's public key). See
`legacymind certify` (signing) and `legacymind verify-cert` (checking).

## ⚠️ This is a DEVELOPMENT key. Do not use it for anything real.

- `legacymind-dev-ed25519.seed` — a 32-byte hex seed that
  **deterministically derives** the demo signing key. It is committed on
  purpose so the demo and benchmark sign reproducibly and offline. It
  grants access to nothing; it is not a credential to any service. It is
  public by construction. Treat any certificate signed with it as a
  demonstration, not an authenticated production artifact.
- `legacymind-dev-ed25519.pub.pem` — the derived public key. This is the
  **trusted key** `verify-cert` pins against by default: a certificate
  signed by any other key is reported as an unknown signer.

Key id (SHA-256 of the SPKI public key, first 16 hex): **9b70a354efb9feab**.

## Production

The private key never lives in the repo. A production signer passes
`legacymind certify --signing-key <pem>` (or sets `LEGACYMIND_SIGNING_KEY`)
pointing at a PEM private key held in a KMS/HSM; the code path is
identical to the demo. Verifiers pin the production public key with
`legacymind verify-cert <cert> --trusted-key <pem>`. Rotating the key is
a matter of re-issuing certificates and publishing the new public key —
the key id in each certificate records which key signed it.
