# The through-rounding lower bound — searching a rounded-gated region

Design for the layer-C solver depth that closes RETAIL's last disclosure:
a half-boundary obligation reachable only on a path **gated by a rounded
quantity**. Composed rounding (`docs/composed-rounding.md`) named this
exact residual — "a lower bound *through* a rounding" — as future depth.
This document designs it and validates the algorithm against the real
GnuCOBOL binary before any engine code is written, matching the
design-first rhythm that de-risked every solver epic.

## The gap

RETAIL is a double-rounding chain with a tier split over the result:

```
WS-DISC-DOL ROUNDED = WS-AMOUNT * 90 / 100      -> D = round0(0.9·A)
WS-TAX      ROUNDED = WS-DISC-DOL * 825 / 10000 -> T = round2(0.0825·D)
WS-TOTAL            = WS-DISC-DOL + WS-TAX       -> D + T
IF WS-TOTAL > 500  -> HIGH  else NORM
```

Both rounding obligations must exhibit a half-boundary tie on **each**
path. On the NORM path they do. On the HIGH path — gated by
`WS-TOTAL > 500`, i.e. `D + round2(0.0825·D) > 500` — both are left
`UNREALIZED` (the two obligation-path combinations in RETAIL's `gaps`).

The root cause is shared. The obligation search seeds its lower bound
with `freeVarLowerBoundScaled`, which reads a bound off **linear**
single-variable constraints only. `WS-TOTAL > 500` is a monotone function
of the *rounded* intermediate `D`, not linear in the input `A`, so it
yields no bound; the search starts at input 0 and its solution cap never
climbs to the high-tier region (`A ≈ 513`). This bites both obligations:

- **round-1** (`WS-DISC-DOL`, a fuzz-free affine `0.9·A`) goes through
  `tryCongruence`, whose congruence min is `freeVarLowerBoundScaled`
  (symexec.ts:2219);
- **round-2** (`WS-TAX`, affine with rounding drift) goes through
  `solveComposedRounding`, whose `minDGrid` derives from the same
  function (symexec.ts:2594).

So one bound enhancement, consulted at two already-wired sites, closes
both.

## Validated ground truth (GnuCOBOL 3.1.2, legacymind/legacy-retail)

Every value below is byte-exact from the real binary.

| input A | D = round0(0.9·A) | T = round2(0.0825·D) | TOTAL = D+T | tier | note |
|---|---|---|---|---|---|
| 512.77 | 461 | 38.03 | 499.03 | NORM | just below the split |
| 512.78 | 462 | 38.12 | 500.12 | HIGH | **round-2 tie** (0.0825·462 = 38.115) |
| 514.99 | 463 | 38.20 | 501.20 | HIGH | not a round-1 tie |
| 515.00 | 464 | 38.28 | 502.28 | HIGH | **round-1 tie** (0.9·515 = 463.5) |

The tier boundary is exactly `D = 462`: `D = 461` gives TOTAL 499.03
(NORM), `D = 462` gives 500.12 (HIGH). And the sound lower bound is
derivable in closed form — with `T ≤ 0.0825·D + 0.005`,
`D + T > 500 ⇒ 1.0825·D + 0.005 > 500 ⇒ D ≥ 462` — which is precisely the
boundary the binary confirms. Elegantly, `D = 462 ≡ 2 (mod 4)` is itself
the round-2 congruence tie, so the search starting at `D_min` lands the
witness `A = 512.78` immediately; the round-1 tie sits a little higher at
`A = 515.00` (`D = 464`), also in the reachable region once the bound
starts the search there.

## The algorithm

Derive a lower bound on input `j` from any path constraint that is a
**monotone-nondecreasing rounded** function of `j` alone, by exact binary
search on `j`'s PICTURE grid — the same monotone-staircase search
`solveMixedRounding` already runs, reusing `exactMonotonePositive`,
`evalExact`, and `constraintHolds`:

1. For each path constraint `c` with `c.exact.rounds.length > 0` (a
   genuinely rounded decision — linear constraints stay with
   `freeVarLowerBoundScaled`), whose exact form is monotone-nondecreasing
   (`exactMonotonePositive`) over a single input equal to `j`, and whose
   holding region is a lower half-space (`constraintHolds` is `false` at
   `j = 0` and `true` at `j = max`):
2. binary-search the smallest on-grid `j` where `constraintHolds(c, ·)`
   flips to `true`. Monotonicity makes this crossing unique and exact.
3. Take the **maximum** such bound over all qualifying constraints (the
   tightest), scaled to `j`'s grid.

Callers combine it with the linear bound: `max(freeVarLowerBoundScaled,
freeVarLowerBoundThroughRounding)`.

**Why it is sound.** The gate is a *necessary* condition of the path:
every witness on that path satisfies it. So the smallest input satisfying
it is a valid lower bound that **cannot overshoot** any real witness —
the direction that matters, because an overshoot would silently skip a
realizable tie (a coverage regression), while an undershoot merely costs
iterations. Monotonicity guarantees binary search finds the exact
threshold, and — as everywhere in the solver — every candidate the search
proposes is still re-checked by `allConstraintsHold`, so a bad bound can
only fail to help, never fabricate a witness.

## Sound subset

The through-rounding bound fires only for a constraint that is:

- genuinely rounded (`c.exact.rounds.length > 0`);
- monotone-nondecreasing in its decision value (`exactMonotonePositive`);
- over exactly one input variable, equal to the search variable `j`;
- a lower half-space on the grid (`constraintHolds` false at 0, true at
  max) — so `<`/`<=`/`==`/`!=` gates, which do not present a clean lower
  threshold, are skipped by the endpoint test rather than mis-inverted.

Everything else keeps today's behavior. Multi-variable rounded gates, and
gates whose holding region is not a lower half-space, are named future
depth, not approximated.

## Wiring

One new function `freeVarLowerBoundThroughRounding(constraints, j,
inputs)` returning the scaled bound (or `null`). Two call sites take the
max with the existing linear bound:

- `tryCongruence`'s `minXInt` (symexec.ts:2219) — closes round-1 on the
  high path;
- `solveComposedRounding`'s `minDGrid` seed (symexec.ts:2594) — closes
  round-2 on the high path (the derived input bound maps forward through
  the inner rounding to `D_min`, exactly as the existing linear path
  already does).

No new statement kinds, no IR change (the `.cbl` is untouched, so the
replay cache does not re-key), no change to the witness filter.

## Per-obligation effect and the regression bar

- **RETAIL** round-1 and round-2 both move `UNREALIZED → realized` on the
  high path: the two unrealized obligation-path combinations go to **0**,
  and RETAIL becomes **gap-free** — its last disclosure closed. Witnesses
  `A = 512.78` (round-2, D = 462) and `A = 515.00` (round-1, D = 464),
  both confirmed on the real binary above.
- **The regression bar is absolute.** The through-rounding bound returns
  `null` unless a path carries a genuinely-rounded, monotone, single-input,
  lower-half-space gate — which no other benchmark module has. BONUS's
  uplift gate `WS-SALES > 50000` is a *direct linear* input
  (`rounds.length === 0`), so the new function skips it and the unchanged
  linear bound handles it exactly as before. Every other module's layer-C
  and layer-D summary must stay **byte-identical** (verified by the
  committed `results.json` diff); a rounding regression anywhere is a
  stop-and-investigate, never a shrug.

## Risks and decided trade-offs

- **Overshoot is the only real risk**, and it is structurally excluded:
  the bound is a necessary-condition threshold (`≤` any witness) and the
  filter re-decides every candidate. The worst a bug can do is leave the
  honest disclosure standing.
- **Only lower half-spaces invert cleanly.** Upper/equality/inequality
  gates are detected by the endpoint test and skipped, not approximated —
  the same "prefer refusing over mis-answering" discipline.
- **Single input only** for now; a multi-variable rounded gate needs a
  joint search and stays disclosed.
