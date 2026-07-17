# transpiler/live-smoke/ — the recorded live-API run

## Purpose

The one thing `repair-fixture/` cannot exercise is the **physical API
call**. This fixture is a real migrate run against the live Anthropic
API (`claude-opus-4-8`, 2026-07-17), recorded into the replay cache so it
now replays offline and deterministically like every other module — the
proof that the generate → verify → repair loop works end-to-end over the
wire, not just from pre-seeded cache entries.

## What happened on the live run

`SMOKE` is a small module (3% processing fee ROUNDED, HELD tier over
TOTAL 800.00) that is **not** in the benchmark registry, so its IR hashes
to fresh cache keys and the calls went to the API for real.

- Both original candidates were generated live and **failed layer B**:
  each emitted the fee/total without the implied `V99` decimal point
  (`modern=000300` vs `legacy=0003.00`), diverging on every non-zero
  case — a faithful, verifier-caught defect, not a staged one.
- **Repair round 1 fired live** ($0.1303): the failure was fed back with
  the verifier's expected-vs-got evidence, and the repaired candidate
  **`a-r1` passed 6/6 selection cases and 200/200 layer A** (seed
  20260717, the anti-overfit gate). Winner `a-r1`, session cost $0.4565.
- A separate earlier attempt with an unfunded key returned a clean
  billing `invalid_request_error` (with request IDs) — proving the
  auth/credential/error path too, distinct from the success path.

## What is committed

- `smoke.cbl` — the module, ground-truthed against the real GnuCOBOL
  binary first (0.50 → the 0.015 half-cent tie → 0.02; 776.70 lands
  TOTAL exactly 800.00 FREE / 776.71 crosses to HELD).
- `smoke-diff.json` — the six layer B selection cases.
- `smoke-prop.json` — the 200-case layer A generator (a live winner must
  survive generated cases, not just the curated ones).
- The three **live-recorded** cache entries (in `transpiler/cache/`,
  keyed by request hash, each with a `note`): candidate `a`, candidate
  `b`, and the repair-round-1 reply that wins. `.request.json` stubs are
  gitignored.

## Replay it (offline, $0)

```
node cli/dist/main.js parse transpiler/live-smoke/smoke.cbl --out out/ir/ --engine proleap
docker build -f harness/gnucobol/Dockerfile --build-arg SOURCE=transpiler/live-smoke/smoke.cbl -t legacymind/legacy-smoke .
node cli/dist/main.js migrate out/ir/SMOKE.ir.json \
  --diff-config transpiler/live-smoke/smoke-diff.json \
  --out out/bench/smoke/migrate --offline --max-repairs 2
```

Expected: both originals fail layer B, repair round 1 replays the
recorded fix, and `a-r1` wins 6/6 at $0.0000.

## Re-running live

Any migrate on a fresh IR without `--offline` calls the API (resolving
`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / an `ant auth login`
profile) and records the replies. `--prop-config` is recommended live so
the winner must clear the 200-case layer A gate.
