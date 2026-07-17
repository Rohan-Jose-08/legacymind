# transpiler/repair-fixture/ — the deterministic repair-loop test

## Purpose

Proves the live transpiler path's **generate → verify → repair** loop
end-to-end from the replay cache, with zero credentials and zero network.
This is the MVP-critical path a real engagement exercises: candidates
that fail verification are handed back to the model *with the verifier's
evidence*, bounded by `--max-repairs`, and the verifier alone decides
whether a repair wins.

## What is committed

- `escrow.cbl` — a small module that is NOT in the benchmark registry
  (3% escrow fee ROUNDED, HELD tier over 1000.00), ground-truthed against
  the real GnuCOBOL binary (100.00 → FEE 3.00; 1000.00 FREE / 1000.01
  HELD; 0.50 → the 0.015 half-cent tie → 0.02).
- `escrow-diff.json` — the layer B selection cases.
- Cache entries for its two ORIGINAL candidates, **deliberately broken**:
  candidate `a` (faithful) uses a 2% rate — every non-zero case diverges
  on FEE, the numeric-divergence evidence path; candidate `b` (idiomatic)
  is missing a semicolon — javac rejects it, the compile-error evidence
  path.
- The cache entry for the **repair-round-1 request of `a`** — the
  corrected candidate, recorded under the deterministic repair key
  (simulating the live model's reply; the request stub embeds the broken
  Java and the exact `FEE: expected 00003.00, got 2.00` evidence).

## Run it

```
docker build -f harness/gnucobol/Dockerfile --build-arg SOURCE=transpiler/repair-fixture/escrow.cbl -t legacymind/legacy-escrow .
node cli/dist/main.js parse transpiler/repair-fixture/escrow.cbl --out out/ir/ --engine proleap
node cli/dist/main.js migrate out/ir/ESCROW.ir.json \
  --diff-config transpiler/repair-fixture/escrow-diff.json \
  --out out/bench/escrow/migrate --offline --max-repairs 1
```

Expected: candidate `a` compiles but FAILS layer B (FEE divergence on
every non-zero case); candidate `b` fails to compile; repair round 1
builds both evidence prompts, replays the recorded repair of `a` from
the cache, compiles it, verifies 5/5, and selects **`a-r1`** as the
winner at $0.0000.

## The live run (one command, needs credentials)

The only thing this fixture cannot exercise is the physical API call —
the SDK client (`cli/src/model/anthropic.ts`) resolves credentials from
`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / an `ant auth login`
profile. To validate live end-to-end, run any migrate WITHOUT `--offline`
on a fresh module (a fresh IR means fresh cache keys, so the calls go to
the API and are recorded for replay):

```
ANTHROPIC_API_KEY=... node cli/dist/main.js migrate out/ir/<FRESH>.ir.json \
  --diff-config <its-diff.json> --prop-config <its-prop.json> \
  --out out/bench/<fresh>/migrate --max-repairs 2
```

`--prop-config` is recommended for live generation: a winner must survive
the layer A generated cases too, not just the curated selection suite.
