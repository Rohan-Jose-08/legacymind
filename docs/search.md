# SEARCH — a serial table search is a bounded PERFORM over the index

Design stage for the `SEARCH` statement, the natural companion to the
`INDEXED BY` index-names that stage 52 brought in. As with every recent
head, the corpus population is measured first and is almost entirely
conformance-test scaffold; the value, if built, is a genuine proof-grade
capability the desugar makes cheap. Ground truth is validated against
GnuCOBOL 3.1.2 (`examples/probes/search.cbl`) and the ProLeap API by
javap before any engine code.

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

## What Layer C then does — bounded search reasoning

Because the loop unrolls at most `N` times over a fixed table, Layer C
enumerates the `N + 1` outcome paths (matched at each occurrence, or ran
off the end):

- **Constant search key** (search a literal): the table cells are
  constants, the loop is fully determined, and the found index folds to a
  constant — every path resolved.
- **Symbolic numeric key** (search an input over a numeric key column):
  the found index is a function of the input; Layer C enumerates the
  outcome paths, and each is realizable by the input that lands the key on
  that cell — genuine new verified reasoning about a search.
- **Symbolic text key** (alphanumeric key column): comparisons over text
  fall to the existing text-twin treatment (never solved over), so those
  paths are disclosed, not mis-answered.

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

## Recommendation

Unlike backward `GO TO` (deferred because it desugars to `PERFORM`, which
adds no new verified behaviour), `SEARCH` earns its build: verifying that
a Java translation of a table search finds the same element at the same
position — the found index as a function of the input — is genuine
proof-grade reasoning about the class of code where off-by-one and
boundary bugs live, and it is the natural completion of the OCCURS/index
family the last four stages built. The desugar reuses everything;
the only real cost is the synthetic-paragraph injection.

So **SR is ready to build**, and is the strongest remaining
capability slice. Build it next if capability breadth is the goal;
the alternative is the non-corpus product roadmap (dashboard/CI). Either
way `SEARCH ALL` and the multi-dimensional/scaffold forms stay named
residuals, not silent gaps.
