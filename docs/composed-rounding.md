# Composed rounding — a congruence over a rounded value

Design for the layer-C solver depth that closes the oldest documented gap
in the rounding engine: a **rounding half-boundary whose expression reads
a value that was itself rounded**. It is the "congruence over a rounded
value" limit flagged on RETAIL (the committed test case), BONUS (the
nested uplift), and PAYSLIP. This document designs the composed solver
and validates its algorithm against the real GnuCOBOL binary before any
engine code is written — the crown-jewels solver is worth de-risking
first, exactly as the data-shape epics were.

## The gap

RETAIL settles a discount to whole dollars, then taxes that settled
amount:

```
COMPUTE WS-DISC-DOL ROUNDED = WS-AMOUNT * 90 / 100     (round to whole $)
COMPUTE WS-TAX      ROUNDED = WS-DISC-DOL * 825 / 10000 (round to the cent)
```

`WS-TAX`'s obligation is to exhibit an input where the pre-rounded tax
lands exactly on a half-cent — the tie that distinguishes half-up from
half-even or truncation. But `WS-DISC-DOL` is not an input; it is
`round0(0.9·A)` for the input `A = WS-AMOUNT`. So `WS-TAX`'s symbolic
value is affine **with rounding drift** (a non-zero fuzz band and an
exact form carrying one round term), and the affine congruence solver —
which solves over the *inputs* — cannot touch it. Today the round
obligation falls through to line 2265 of `symexec.ts` ("expression
carries rounding drift on this path") and then the v1 producer-inversion
fallback, which only accepts a bare `source * constant`; RETAIL's
`round-2` is left `UNREALIZED`.

## The exact form we can exploit

Stage 27 made `RoundTerm.inner` a recursive `ExactForm`, so `WS-TAX`'s
symbolic value carries its structure exactly:

```
exact = { affine: 0,
          rounds: [ { coeff: 0.0825, mode: half-up, scale: 0,
                      inner: { affine: 0.9·A, rounds: [] } } ] }
```

That is **one round term times a constant, over an affine inner** — the
sound subset below. The pre-rounded tax is `coeff · D` where
`D = round0(0.9·A)` is a whole-dollar integer.

## The composed algorithm

The pre-value `coeff·D` takes one discrete value per integer `D`, so the
half-cent tie is a congruence on `D`, and each qualifying `D` is inverted
back through the inner rounding to an input interval:

1. **Outer congruence — solve for the rounded value D.** Find `D` on the
   intermediate's grid (here the whole dollar, `scale 0`) such that
   `coeff · D` lands on a half-unit at the target scale `st`. For RETAIL
   `coeff = 825/10000`, `st = 2`: `825·D ≡ 5000 (mod 10000)`, i.e.
   `D ≡ 2 (mod 4)` — `D ∈ {2, 6, 10, 14, …}`. This reuses
   `solveCongruence`, but over `D` (a synthetic variable with the
   intermediate's grid and `[round(inner over the input domain)]` range)
   rather than over an input.
2. **Inner inversion — invert the rounding to an input.** For each `D`,
   `round0(0.9·A) = D ⟺ 0.9·A ∈ [D − ½, D + ½)`; drive the affine inner
   `0.9·A` to a point of that interval and read off an on-grid `A`. This
   is exactly the inner half of `solveThroughRounding` (round(inner)=v →
   inner ∈ [v−½ulp, v+½ulp) → `solveEquality` on the inner affine), reused
   with `v = D`.
3. **Filter, then emit.** Every candidate `A` is checked against the full
   path constraint set with `allConstraintsHold`; only survivors become
   witness cases (`toStdin`), identical to the affine congruence path. A
   bad proposal is filtered, never trusted — the same "the constraint
   filter decides" discipline that keeps every prior solver stage sound.

## Validated against the real binary

Ground-truthed on `legacymind/legacy-retail` (real GnuCOBOL 3.1.2), which
confirms both halves of the algorithm:

| input A | WS-DISC-DOL (D) | WS-TAX | half-cent tie |
|---|---|---|---|
| 2.77  | 2  | 0.17 | ✓ (0.165 → 0.17) |
| 6.12  | 6  | 0.50 | ✓ (0.495 → 0.50) |
| 10.56 | 10 | 0.83 | ✓ (0.825 → 0.83) |
| 10.55 | 9  | 0.74 | no — D=9 is not ≡ 2 (mod 4) |
| 11.66 | 10 | 0.83 | ✓ — top of the D=10 interval |
| 11.67 | 11 | 0.91 | no — D=11, interval boundary |

So `D ≡ 2 (mod 4)` picks the half-cent ties, and inverting
`round0(0.9·A) = 10` gives the on-grid witness interval `A ∈ [10.56,
11.66]` (`A = 10.55 → D = 9`, `A = 11.67 → D = 11`). The hand-named
witness `A = 10.56, D = 10` from the RETAIL disclosure is reproduced.

## Sound subset (first implementation)

The composed solve fires only when the round obligation's expression has
an exact form of exactly this shape:

- `rounds.length === 1` and the surrounding `affine` is a constant
  (`const + coeff·round_s(inner)`; RETAIL's constant is zero);
- the round term's `inner` is affine — `inner.rounds.length === 0` (one
  level of nesting; a doubly-nested intermediate stays disclosed);
- a single input variable in `inner` (so the inversion is one-variable);
- unsigned PICTURE domains (the existing inversion assumption).

Everything else keeps today's honest disclosure. Two-level and
multi-variable composed forms are named future depths, not silently
promised.

## Wiring

One new solver `solveComposedRounding(exact, st, inputs, fixedCandidates,
constraints)` returning the witness assignments, called from the round
obligation's "carries rounding drift" branch (`symexec.ts` ~2265) before
that path is disclosed as unrealized. It reuses `solveCongruence`
(outer), the inner-inversion of `solveThroughRounding` and `solveEquality`
(inner), and `allConstraintsHold` (filter). `anySolvable` is set when it
realizes a case, so the v1 producer-inversion fallback stays off for
these expressions.

## Per-obligation effect and regression bar

- **RETAIL** `round-2` moves `UNREALIZED → VERIFIED` (witnesses
  A = 1.67, 6.12, 10.56, 15.00, 19.45, all confirmed on the real binary).
  A residual disclosure remains on the high-tier path, where the gating
  constraint is `WS-TOTAL > 500` over the *rounded* total — a linear
  lower bound on the input cannot be derived from a rounded constraint,
  so the composed search cannot start in that region. That is the same
  limit RETAIL's `round-1` already discloses on the same path, not a new
  one, and is a named future depth (a lower bound *through* a rounding).
- **BONUS** (nested uplift over 50000) becomes **gap-free**: its uplift
  is gated behind `IF WS-SALES > 50000` — a *direct-input* constraint —
  so `freeVarLowerBoundScaled` yields the lower bound and the composed
  search starts at the reachable intermediate (witness WS-SALES ≈
  50000.17, D = 1500.01), confirmed on the binary.

So the composed solve starts its congruence at the smallest intermediate
reachable under the path's *linear* input bounds; where the gate is a
rounded quantity (RETAIL's high tier) the honest disclosure stays.
- **The regression bar is absolute**: every other module's layer-C
  summary must stay byte-identical (the composed solve only fires on the
  new shape — affine-with-round-drift single-term expressions — which no
  prior module's rounding obligation hits; verified by the committed
  results.json diff). A rounding regression anywhere is a stop-and-
  investigate, never a shrug.

## Risks and decided trade-offs

- **Regression to the rounding engine is the real risk**, so the change
  is gated on the exact-form shape and the witness filter is unchanged —
  the composed solve can only *add* realized cases, never alter an
  existing verdict. The byte-identical bar catches any leakage.
- **Grid existence** — the inverted interval may contain no on-grid input
  for some `D`; the solver tries successive `D` solutions and, failing
  all, leaves the honest disclosure. It never fabricates an off-grid
  witness (the filter would reject it anyway).
- **Congruence over a doubly-rounded value** (both the discount *and* an
  intermediate rounded again) stays out of subset — the inner must be
  affine. Disclosed, not approximated.
