# Search enumeration — compound conditions split into paths

Design for the Layer C capability that finding 8 established as missing:
reasoning about a serial table search, where the found index and the
selected value are functions of the input. Stage 53 designed the SEARCH
desugar (a bounded `PERFORM VARYING` over the index with a compound
guard); stage 53b proved the desugar sound on the binary but measured
Layer C realizing **0 of 4 obligations** on it. This document locates the
gap precisely and designs the fix. Every claim is grounded in the current
engine source and in the committed probe
(`examples/probes/search-desugar.cbl`), whose outputs are already
binary-validated (code 33 → price 3.75; missing code → 0).

## The gap, located exactly (it is smaller than stage 53b estimated)

Stage 53b named three missing capabilities: OR-splitting,
subscript-in-condition resolution, and match-position forking. Reading
the engine, two of the three already exist:

- **Match-position forking exists.** `unrollLoop` forks exit/iterate at
  every depth, pushes the guard decision as a path constraint, and prunes
  provably-false forks — the probe's Layer C run enumerated 28 paths and
  proved 13 infeasible. The forking machinery needs nothing new.
- **Subscript-in-condition resolution exists.** A `PERFORM VARYING`
  index is a constant at each unrolled depth (the unroller stores
  `var + by` after each body), and `parseExpression`'s table-cell
  resolution (`tableCell`, stage 38) resolves `W-CODE(IX)` under that
  constant to the cell's environment value — here a literal-filled
  constant.
- **The one structural hole is `parseCondition`.** Its regex splits on a
  single relational operator, so `IX > 5 OR W-CODE(IX) = W-WANT`
  mis-splits at the first `>` (right-hand side `5 OR W-CODE(IX) = ...`
  is not an expression), returns `null`, and both the loop guard and the
  post-loop `IF` fall to "condition is not affine; path constraints
  incomplete". The forks still happen — but **unconstrained**, so no
  witness can be realized on any of them and every obligation discloses.

## The design — DNF splitting at the condition level

Compound conditions become path structure, not solver surface. For a
condition `A OR B` asserted with truth value `t`:

- **`t = false`** (e.g. the iterate branch of the search guard): push
  `¬A` and `¬B` as **two atomic constraints** on the same state — a
  conjunction needs no new machinery, `allConstraintsHold` already
  requires every constraint.
- **`t = true`** (e.g. the exit branch): **fork** the state into two
  mutually exclusive, jointly exhaustive states — one carrying `A`, one
  carrying `¬A ∧ B`. Each fork's constraints stay atomic, so witness
  solving, congruence, staircases, and the constraint filter all work
  unchanged.

`A AND B` is the dual (true pushes both; false forks `¬A` | `A ∧ ¬B`).
Nesting recurses; negation of a relational op is the existing op flip.
The change lands in the two consumers of `parseCondition` — the `if`
case in `execute` and `pushLoopCond` — which fork on a list of
constraint-sets instead of exactly one.

## Why this yields exactly the search semantics (hand prediction)

For the probe's guard `IX > 5 OR W-CODE(IX) = W-WANT` over N = 5 with
`IX = k+1` constant at depth k:

- **Iterate at depth k < 5**: guard false ⇒ push `¬(IX > 5)` (constant
  true, harmless) and `W-CODE(k+1) ≠ W-WANT` — the accumulating
  "not matched yet" prefix.
- **Exit at depth k < 5**: fork 1 carries `IX > 5` — constant **false**,
  pruned by the existing provably-false check; fork 2 carries
  `W-CODE(k+1) = W-WANT` — the **matched at occurrence k+1** path, with
  the ≠-prefix from earlier iterations already on the state.
- **Exit at depth 5**: fork 1 carries `IX > 5` — constant true — the
  **ran-off-the-end** path; fork 2 (`¬A ∧ B`) has `¬(IX > 5)` constant
  false, pruned.

Net: exactly **N + 1 = 6 feasible outcome paths**, each with atomic
affine constraints: `W-WANT = cell_k ∧ W-WANT ≠ cell_1..k−1` for k =
1..5, plus `W-WANT ∉ {11,22,33,44,55}` for at-end. The post-loop
`IF IX > 5` is constant-decidable per path (IX is 6 only on the at-end
path), so the found-value MOVE resolves per path to the matched cell's
price — the found index and selected value become verified functions of
the input, which is the entire point.

## Witness realization on the new paths

A match path's binding constraint is an affine **equality**
(`W-WANT − cell_k = 0`). The path-witness machinery already repairs
witnesses through the constraint filter; equalities over one input are
solvable by the existing `solveEquality`, and the ≠-prefix constraints
are filters, not targets. The at-end path is realized by any input
outside the five cell values (the base case's repair belt). Where a cell
column is **alphanumeric**, the equality falls to the text-twin
treatment and those paths stay disclosed — text search is out of the
first subset, exactly as the X-scalar discipline everywhere else.

## Sound subset and gates

- Compound splitting applies to `OR`/`AND` of **relational atoms** the
  existing `parseCondition` handles; anything unparseable inside an atom
  keeps today's honest "not affine" note on that fork.
- Path growth is bounded: an OR adds at most one extra fork per
  assertion, and the search shape's forks are pruned to N + 1 by the
  constant-index checks; `MAX_PATHS` remains the global guard.
- No IR change, no frontend change, no cache re-key: condition texts
  already carry `OR`/`AND` verbatim.

## Regression bar

No committed module's conditions contain `OR`/`AND` (verified by
grepping the 26 modules' sources and IR condition texts before
implementation), so every existing path enumeration must stay
**byte-identical** — the new code is reachable only by compound
conditions. The scant probe graduates from "0 of 4 obligations, all
disclosed" to realized branch outcomes; SEARCH itself (the desugar from
docs/search.md) becomes buildable end-to-end afterwards, as its own
module stage with candidate B carrying a search off-by-one (found index
shifted by one — the archetypal defect this capability exists to catch).

## Named residuals

- **Text-key searches** (alphanumeric equality): disclosed, not solved —
  the text-twin discipline.
- **NOT / parenthesized boolean nesting beyond OR/AND chains**: rejected
  to the honest note until needed.
- **`SEARCH ALL`**: still a separate construct (binary probe sequence
  over a key-ordered table).
