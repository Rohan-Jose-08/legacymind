# SEARCH — a serial table search is a bounded PERFORM over the index

Design stage for the `SEARCH` statement, the natural companion to the
`INDEXED BY` index-names that stage 52 brought in. As with every recent
head, the corpus population is measured first and is almost entirely
conformance-test scaffold. Ground truth is validated against GnuCOBOL
3.1.2 (`examples/probes/search.cbl`) and the ProLeap API by javap.

**Status: designed, and the design was corrected by a build attempt.**
The desugar below is sound and lowers, but pushing the hand-written
desugared form through the symbolic engine
(`examples/probes/search-desugar.cbl`) showed Layer C cannot yet reason
about the search — so SEARCH is a two-part effort (frontend desugar +
a new Layer C search-enumeration capability), not the cheap
desugar-and-reuse first assumed. Not built; see the corrected
recommendation.

## The corpus population, measured

143 `SEARCH` statements (100 serial `SEARCH`, 43 `SEARCH ALL`) — but
across only **13 files**, ten of them the NIST **NC-series** SEARCH
feature-test programs, on the same multi-dimensional `INDEXED BY` tables
the stage-52 measurement found (`TABLE-1(INXEX1 INXEX2 INXEX3)`). So the
corpus `SEARCH` population is the most concentrated scaffold yet: it
tests the statement itself, on tables the subset does not lower. The
everyday 1-D table-lookup idiom is under-represented here but real.

## The model — validated ground truth (GnuCOBOL 3.1.2)

Serial `SEARCH tbl AT END ae WHEN cond wb END-SEARCH` walks the index
from its **current** value upward, **test-then-increment**:

- **Match** — `SET IX TO 1` then search "CC" over `AA|BB|CC|DD` lands the
  index on occurrence 3 and runs `wb` (`FOUND=030 POS=03`).
- **End** — a missing key runs `ae` with the index **one past the table**
  (`FOUND=999 POS=05` for N=4).
- **Starts at the current index, no wrap** — searching "AA" (occurrence 1)
  with `IX` pre-set to 3 does *not* find it; `ae` fires (`FOUND=888
  POS=00`).

So a `SET`-before-`SEARCH` is a bounded loop over the index, and the
found position is a function of the table contents and the search
argument.

## The desugar — existing IR, reusing stage 52

The semantics are exactly a `PERFORM VARYING` over the index with the
`WHEN` condition as an early exit:

```
SEARCH tbl AT END ae WHEN cond wb END-SEARCH
  ==>
PERFORM <no-op> VARYING IX FROM IX BY 1 UNTIL IX > N OR (cond)
IF IX > N THEN ae ELSE wb
```

`PERFORM VARYING` tests its `UNTIL` before each step, so with the index
starting at its current value this reproduces test-then-increment
exactly: the index lands on the first matching occurrence, or on `N + 1`
when none matches. Every piece is already lowered — `PERFORM VARYING`,
the `SET`-index arithmetic (stage 52, `docs/occurs-indexed.md`), and
`IF` — so **the verifier is untouched**, the sixth epic in a row to reuse
an existing model. The one genuinely new frontend mechanism is injecting
a synthetic no-op body paragraph for the `PERFORM` to range over (the
`SEARCH` body statements move into the `IF` arms, not the loop) — more
invasive than the data-item injection stage 52 used, because paragraphs
carry order, CFG edges, and PERFORM-reachability.

## What Layer C then does — measured, and it is NOT free (design correction)

The first draft of this design claimed Layer C would enumerate the
`N + 1` outcome paths "for free" via the existing unroller. **That was
wrong, and the correction is the load-bearing finding of the build
attempt.** The desugar was hand-written as real COBOL
(`examples/probes/search-desugar.cbl`), lowered, and run through the
symbolic engine. The desugar is sound — it parses, and it matches the
binary (code 33 → price 3.75, missing code → default). But Layer C
realizes **0 of 4 obligations**, every one honestly disclosed:

```
UNREALIZED branch: IF IX > 5 OR W-CODE(IX) = W-WANT
  condition is not an affine form on any path; needs nonlinear reasoning
UNREALIZED round:  COMPUTE W-FEE ROUNDED = W-FOUND * 5 / 100
  expression not solvable on any path (W-FOUND is a data-dependent select)
```

The reasons are structural, not incidental: (a) the loop guard is a
**compound `OR`** the affine condition-evaluator does not split into its
two branches; (b) the `WHEN` half, `W-CODE(IX) = W-WANT`, is an
**equality over a subscripted cell** that the evaluator does not resolve
even with `IX` pinned per iteration; and (c) the searched-out value
`W-FOUND` is a **data-dependent selection** (which cell matched), not an
affine form, so every obligation downstream of the search falls through.

So the found-index-as-a-function-of-input reasoning — the thing that
makes verifying a search valuable — is exactly what the current engine
**cannot** do. Realizing it needs genuinely new Layer C machinery:
`OR`-condition path-splitting, subscript-in-condition resolution under a
pinned index, and match-position forking (fork the search into "matched
at cell k, so `key = cell_k` and `key ≠ cell_1..k-1`" for each k, plus
no-match). That is a crown-jewel-executor change and its own stage — not
the verifier-untouched reuse this document first assumed.

## The sound subset — SR (serial search, flat table)

- serial `SEARCH` (not `SEARCH ALL`);
- over a flat 1-D `INDEXED BY` table whose leaves are the O1/O2x/O3-flat
  set, with the index `SET` before the search;
- a single `WHEN` with a decidable relational condition over a table leaf;
- no `SEARCH VARYING` second counter.

Everything else rejects loudly.

## Named residuals (disclosed, not approximated)

- **`SEARCH ALL`** (binary search over an `ASCENDING/DESCENDING KEY`): a
  separate construct — the key ordering is a precondition, and the binary
  probe sequence is not the serial walk; its own stage.
- **`SEARCH VARYING`** (a second index/counter advanced in lockstep);
  **multiple `WHEN`s** and **compound conditions**; **multi-dimensional
  tables** (the NIST corpus shape).

## Recommendation (revised after the build attempt)

The build attempt reset the estimate. SEARCH is two pieces, not one:

1. **The frontend desugar** — recognize `SEARCH`, emit the `PERFORM
   VARYING` + `IF` + synthetic no-op paragraph. Cheap and validated; it
   lowers, runs, and would certify a module **through Layers A/B/D**
   (differential execution and flow), with Layer C disclosing the search
   obligations as unrealized — the same shape as BATCHSUM, which certifies
   with zero Layer C obligations realized. Honest, but it undersells the
   differentiator on precisely the construct where symbolic proof is most
   valuable.
2. **The Layer C search-enumeration engine** — `OR`-condition splitting,
   subscript-in-condition resolution, and match-position forking, so the
   found index and the selected value become verified functions of the
   input. This is the real value and the real cost; it is a crown-jewel
   executor change, and it warrants its own design+build stage of the kind
   the composed-rounding and through-rounding solvers each got.

So SEARCH is **not** the cheap "desugar-and-reuse" this document first
claimed, and shipping only piece 1 would be a Layer-C-hollow module on a
construct that exists to be symbolically reasoned about. The honest plan
is to build SEARCH properly — piece 1 plus piece 2 — as a dedicated
Layer C stage, or to shelve it for the product roadmap (dashboard/CI).
`SEARCH ALL` and the multi-dimensional/scaffold forms remain named
residuals either way. The correction itself — that a plausible desugar
can lower and run yet leave the symbolic engine unable to reason —
belongs in the findings log: the layers cross-check the *design*, not
just the code.
