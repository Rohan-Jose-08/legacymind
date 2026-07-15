# Multi-variable rounded boundaries — the restricted-line search

Design and implementation for the layer-C solver depth named as future
work since composed rounding: a **branch boundary over several
independently-rounded inputs**. MANIFEST carries the live instance — its
BIG tier splits on `W-EXT(1) + W-EXT(2) + W-EXT(3)`, three ROUNDED
extensions over three separate quantities — and until this stage that
obligation was honestly disclosed as unrealized ("condition value drifts
through more than one rounded store; needs deeper inversion"). Every
claim below is validated against the real GnuCOBOL binary before the
engine change.

## The gap

The branch-boundary solver ladder ran three tiers: linear
(`solveEquality`), single rounded store inverted (`solveThroughRounding`),
and the single-variable monotone staircase (`solveMixedRounding`, gated
on `exactVarSet(exact).size === 1`). TARIFF's tier boundary verified
because its rounded sum reads **one** input (one weight, three constant
rates). MANIFEST's reads three: the exact form is
`round2(2.35·q1) + round2(1.15·q2) + round2(0.55·q3) − 100`, monotone
nondecreasing in each input but outside every tier.

## The algorithm — restrict to a line, then reuse the staircase

Partial evaluation of an exact form at a concrete point is exact. So:

1. **Restrict** (`restrictExactToVar`): pick a free input `j` and a path
   base case; fold every other input's affine terms into the constant and
   recurse into round terms — a term whose inner no longer mentions `j`
   evaluates to its exact rounded constant (`ratRound(evalExact(...))`),
   one that still does keeps its (restricted) inner. The result is the
   exact decision value **on the line through the base case along `j`**.
2. **Search the line** (`solveMixedRoundingMultiVar`): run the existing
   single-variable monotone staircase on the restricted form, trying each
   free input in turn over the path's fixed candidates.
   `solveMixedRounding` re-checks its own single-var/monotone gate, so a
   restriction that loses monotonicity in the free input simply skips.
3. **Filter**: every candidate is re-decided by `allConstraintsHold`
   against the full path constraint set, unchanged. A line search that
   finds nothing leaves the honest disclosure standing.

Soundness is inherited: a witness found on a line is a true witness of
the full form (the restriction is exact there), and the filter decides.
The search is deliberately **incomplete** — it probes the lines through
the base cases, not the full input box — so it can only add realized
cases, never fake one; an exact-zero boundary that exists off every
probed line stays disclosed.

## Validated ground truth (GnuCOBOL 3.1.2, legacymind/legacy-manifest)

Both restricted-line brackets hand-computed and confirmed byte-exact:

| line | inputs | TOTAL | tier |
|---|---|---|---|
| q1 (q2=5.5, q3=2.1) | 39.3 / 39.4 | 99.85 / 100.08 | STD / BIG |
| q2 (q1=10.0, q3=2.1) | 65.5 / 65.6 | 99.99 / 100.10 | STD / BIG |

And no on-grid input hits the boundary exactly on any of the three base
lines (the rounded staircases jump over zero), so the boundary-0 case
correctly stays a note while ±1ulp realize.

## Effect and the regression bar

- **MANIFEST** `branch-2` moves UNREALIZED → VERIFIED: boundary −1ulp and
  +1ulp realized on restricted lines, both witnesses passing against the
  real binary; the exact-zero offset falls to the "no on-grid inputs
  reach boundary" note. The module's remaining disclosure is the
  loop-condition boundary (`IF I > 3`) — the documented loop class, a
  different residual.
- **The regression bar is absolute**: the new tier fires only for
  monotone multi-variable rounded forms, which no other module's branch
  conditions carry (TARIFF's is single-variable and keeps its tier). All
  24 prior modules must stay byte-identical in layer C/D summaries.

## Named residuals

- **Exact-zero boundaries off the probed lines** — a joint search over
  the input box (not line restrictions) would be needed; disclosed.
- **Non-monotone multi-variable forms** (mixed-sign coefficients) — the
  staircase argument fails; disclosed.
- **The loop-condition class** (`IF I > 3`) — the counter is not an
  input; a different machinery (loop-bound reasoning), not this one.
