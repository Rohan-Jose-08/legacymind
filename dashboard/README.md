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

## Auth model

- `middleware.ts` runs AuthKit in `middlewareAuth` mode: every route except
  `/callback` requires a session; unauthenticated requests are redirected
  to the WorkOS hosted sign-in. No anonymous surface exists.
- `/api/artifact/[...path]` additionally re-checks the session (defense in
  depth) and serves only files inside `LEGACYMIND_DATA_DIR` with an
  extension allowlist — certificate paths are mapped into that directory
  or dropped, so a hand-edited certificate cannot exfiltrate other files.

## Pages

- `/` — certificate list: verdict badges, per-layer status chips, disclosed
  gap count, per-module and aggregate LLM cost.
- `/certs/[slug]` — one certificate: provenance (source/target hashes,
  model, candidate), layer table with coverage, the gaps panel, remaining
  unverified branches (layer C unrealized obligations and uncovered paths),
  and evidence downloads (certificate, layer reports, selection report,
  certified Java source).

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
- The dashboard trusts `LEGACYMIND_DATA_DIR` content. It is a viewer for
  artifacts you produced; it does not validate integrity hashes yet
  (planned: verify `integrity.hash` and show a tamper warning).
