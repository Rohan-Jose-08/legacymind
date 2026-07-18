# dashboard/ — verification dashboard (v1)

## Purpose

The customer-facing window onto the pipeline: per-module certification
status, the coverage envelope, the cost meter, remaining unverified
branches, and downloadable evidence — everything behind WorkOS SSO from the
first request. The dashboard is **read-only over pipeline artifacts**: it
renders what `legacymind certify` produced and never re-runs verification.

Stack: Next.js 15 (App Router) + Tailwind 4 + WorkOS AuthKit
(`@workos-inc/authkit-nextjs` v4).

## Setup

1. Copy `.env.example` to `.env.local` and fill in the WorkOS values
   (client ID, API key, a 32+ char cookie password).
2. **In the WorkOS dashboard** (dashboard.workos.com → Redirects): register
   `http://localhost:3000/callback` as a redirect URI for the environment.
   Sign-in fails with a WorkOS error page until this is done — it is the
   only step that cannot be automated from here.
3. ```
   npm install
   npm run dev        # http://localhost:3000
   ```

`LEGACYMIND_DATA_DIR` (default `../out`) points at the pipeline's output
directory; the dashboard lists every `certification*.json` it finds there.

## Demo data

`../out` accumulates first-run debris — early content-hash-only
certificates and negative-test fixtures — that render as confusing
"unsigned" rows. For a clean customer-facing snapshot, stage exactly the
27 signed module certificates named in `benchmark/modules.json`:

```
node stage-demo-data.mjs          # writes ./demo-data (verifies every signature)
LEGACYMIND_DATA_DIR=./demo-data npm run dev
```

The script copies certificates byte-for-byte (signatures intact) and
fails loudly if any is unsigned, tampered, or signed by an untrusted key.
`demo-data/` is gitignored; commit it only for a remote deploy that
cannot reach `../out` (below).

## Deploy

The dashboard is the `dashboard/` subtree of the repo. On any Next.js
host (Vercel is the least-friction path for App Router):

1. Set the environment variables from `.env.example` in the host's
   project settings — the WorkOS client ID, API key, cookie password, and
   **production** redirect URI (`https://<domain>/callback`, registered
   under Redirects in the WorkOS dashboard, replacing the localhost one).
2. Make the trusted key reachable. `../keys` is outside the deployed
   subtree, so a copy of the public key is vendored here as
   `trusted-key.pub.pem`; set `LEGACYMIND_TRUSTED_KEY=./trusted-key.pub.pem`.
   Use forward slashes — on a Linux host a backslash is a literal filename
   character, and the signature panel silently degrades to "no trusted key
   configured" (signatures still verify for integrity; only provenance is
   unchecked). `trusted-key.pub.pem` is the DEMO key (id `9b70a354`) —
   replace it with your real public key before any non-demo exposure.
3. Provide the data: a host that cannot see `../out` needs a committed
   `demo-data/` (run the staging script, commit the directory, point
   `LEGACYMIND_DATA_DIR` at it).

Known limitation: certificates embed absolute report paths from the
machine that produced them, so **evidence-download links resolve only on
that machine**. The core dashboard — verdicts, per-layer status,
signature verification, coverage, gaps, and cost — reads solely from the
certificate JSON and is fully host-independent. Making download links
portable requires the pipeline to sign data-dir-relative paths (a
`certify` change plus a re-sign of every certificate), tracked as its own
stage.

Before exposing certificates beyond a private demo, re-sign with a
non-demo key: the committed signing key is the deterministic DEMO key
(see `keys/README.md`), and the dashboard pins the trusted public key, so
a real keypair is a key-file swap plus `LEGACYMIND_TRUSTED_KEY`.

## Auth model

- `middleware.ts` runs AuthKit in `middlewareAuth` mode: every route except
  `/callback` requires a session; unauthenticated requests are redirected
  to the WorkOS hosted sign-in. No anonymous surface exists.
- `/api/artifact/[...path]` additionally re-checks the session (defense in
  depth) and serves only files inside `LEGACYMIND_DATA_DIR` with an
  extension allowlist — certificate paths are mapped into that directory
  or dropped, so a hand-edited certificate cannot exfiltrate other files.

## Pages

- `/` — certificate list: verdict badges, a **signature badge per
  certificate**, per-layer status chips, disclosed gap count, an
  aggregate "signatures verified" tile, and per-module/aggregate LLM cost.
- `/certs/[slug]` — one certificate: an **Authenticity** section
  (signature verdict, algorithm, signer key vs the trusted key, content
  digest), provenance (source/target hashes, model, candidate), layer
  table with coverage, the gaps panel, remaining unverified branches
  (layer C unrealized obligations and uncovered paths), and evidence
  downloads (certificate, layer reports, selection report, certified Java
  source).

## Signature verification

`lib/verify.ts` verifies each certificate's Ed25519 signature server-side
— the same two checks as `legacymind verify-cert`: the signature covers
the canonical certificate body (integrity — any edit breaks it), and the
embedded public key is pinned against the trusted key (provenance). The
canonical form mirrors `cli/src/sign.ts` exactly, so a CLI-signed
certificate verifies here byte-for-byte. The trusted public key defaults
to `../keys/legacymind-dev-ed25519.pub.pem`; override with
`LEGACYMIND_TRUSTED_KEY` to pin a production key. A tampered or
wrongly-signed certificate renders a red **SIGNATURE INVALID** /
**UNTRUSTED SIGNER** badge instead of quietly displaying as valid.

## Failure modes

- **Sign-in errors before the redirect URI is registered** in the WorkOS
  dashboard (step 2 above) — this is WorkOS validating the allowlist, not
  an app bug.
- Secrets live only in `.env.local` (gitignored). Rotate the WorkOS API
  key from the dashboard if it may have been exposed; the app only needs
  the new value in `.env.local`.
- Artifacts that fail to parse are skipped silently on the list page —
  acceptable for v1, but a corrupt certificate should eventually surface
  as its own error state.
- Signature verification runs server-side on every render; a certificate
  whose signature does not verify is still listed, but flagged red rather
  than hidden — a tampered artifact must be visible, not silently dropped.
