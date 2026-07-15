# OCCURS — tables as the layout repeated N times

Design for the OCCURS epic: fixed-size tables and subscripted references.
OCCURS is the **#9 unlowered construct** in the corpus sweep (555
instances, `benchmark/parse-coverage.json`), and it is the gate on the
subscripted half of the **#2 construct** — "MOVE target
(qualified/subscripted)" at 3,161 — since a subscripted reference is
exactly a table access. Closing OCCURS therefore unblocks materially
more than its own count.

OCCURS is the third consumer of the byte-layout model that file I/O stage
2b built (`docs/memory-layout.md`) and REDEFINES reused
(`docs/redefines.md`): 2b decodes one byte range through one layout,
REDEFINES decodes one range through two, and **OCCURS repeats one layout
N times, with a subscript selecting the copy**. Every claim below is
validated against real artifacts — GnuCOBOL 3.1.2 was probed through
`examples/probes/occurs.cbl`, and the ProLeap API was confirmed by a live
frontend run.

**Status:** stages **O1 and O2 are implemented and certified** (the TABSUM
module), and **O2x — elementary alphanumeric (X(n)) elements — is
implemented and certified** (the TARIFF module): layer C carries X cells
as text values it never solves over (exactly the X-scalar treatment,
stores resolved per cell at literal subscripts), and layer D's one-region
table model is type-agnostic, matching a modern String[] array region. The frontend lowers a fixed `OCCURS n TIMES` and admits
subscripted references (ACCEPT / arithmetic / COMPUTE / MOVE targets, and
affine subscripts like `W-VAL(2*I)`) to a table, rejecting DEPENDING ON /
INDEXED / SORT / group elements; layer C resolves a subscript to a
definite cell via the unroller and layer D unions the table into one
logical region — matched on the modern side by array-region support in
JavaFlow (an array is one flow region, all elements union), so a faithful
array+loop translation flows symmetrically (the SETTLE module). Selective
access (a strided subscript that touches only some cells) is covered
dynamically by layers A/B and by layer C's per-cell obligations, not by
layer D's coarse union — a value/index bug there is B/C's to catch. O3's
remaining parts (group elements, 2-D tables) stay designed-not-built
below.

## What OCCURS is

`05 W-VAL OCCURS 5 TIMES PIC 9(4)V99` declares five contiguous copies of a
`9(4)V99` element. A subscript selects one: `W-VAL(3)` is the third copy,
**1-based**. The table occupies `count × element_width` bytes with element
`k` at offset `(k − 1) × element_width`.

## Validated ground truth (GnuCOBOL 3.1.2)

Probe: `examples/probes/occurs.cbl`. Confirmed byte-for-byte:

- **Contiguous storage** — a `9(4)V99` element `OCCURS 5 TIMES` holding
  10.00 / 20.50 / 5.25 / 100.00 / 3.75, viewed through an `X(30)`
  REDEFINES, is `001000002050000525010000000375`: five 6-byte fields at
  offsets 0/6/12/18/24. Element `k` is at `(k − 1) × 6`, exactly the
  layout model repeated.
- **Sum via PERFORM VARYING** — `PERFORM VARYING I FROM 1 BY 1 UNTIL I >
  5 / ADD W-VAL(I) TO W-TOTAL` totals 139.50: the loop index subscripts
  the table (the canonical table idiom).
- **Constant subscript** — `W-VAL(4)` reads 100.00 (offset 18).
- **1-based** — `W-VAL(1)` is the first element (offset 0).

## ProLeap

Confirmed by a live frontend run: every OCCURS clause is detected and
currently rejected, and each subscripted reference is already flagged as
"MOVE target (qualified/subscripted)" (the stage-25 resolveQualified path
sees the glued token `W-VAL(1)`). `OccursClause.getTo()` is the fixed
count (an `IntegerLiteral`, 5); `getFrom()` is the lower bound of an
`OCCURS m TO n` range; `getOccursDepending()` marks OCCURS DEPENDING ON
(the variable-length case), `getOccursIndexed()` marks INDEXED BY, and
`getOccursSorts()` marks ASCENDING/DESCENDING KEY — every non-fixed
variant is visible for a loud rejection.

## The central problem — a name resolves to one of N cells

Like REDEFINES, OCCURS breaks the assumption behind the name-keyed store,
but differently. REDEFINES gives two names to one cell; OCCURS gives one
name to **N cells**, and which cell a reference means is chosen by the
subscript *at reference time*. `W-VAL(I)` is not a variable — it is a
family of variables indexed by the runtime value of `I`.

The engine already has the tool that tames this: the **loop unroller**.
The canonical idiom accesses the table through a `PERFORM VARYING` index,
and layer C already unrolls that loop to a fixed set of iterations, each
with a *constant* index. At a constant subscript `k`, `W-VAL(k)` names one
definite cell — the resolution is decidable. A subscript that is a
literal is the same, trivially. So the sound subset is exactly the
subscripts the engine can drive to a constant.

## Staged sound subset

**Stage O1 — fixed table, constant/loop-index subscripts, elementary
numeric elements (the minimal first implementation).** A `01`/`05` group
containing one `OCCURS n TIMES` elementary unsigned numeric DISPLAY
element, `n` a literal. References are subscripted only by (a) an integer
literal, or (b) a single `PERFORM VARYING` index the unroller drives over
`1..n`. The table's `n` cells are modeled as `n` distinct storage cells
(`W-VAL[0..n-1]`); `W-VAL(k)` resolves to cell `k − 1`. This is the
sum-a-table / scan-a-table idiom, and it reduces to machinery layer C
already has — the unroller produces the constant subscripts, and each
resolved cell is an ordinary variable (or input).

**Stage O2 — table elements populated as a fixed input vector.** The
`n` cells are inputs (the table is ACCEPTed or read element-by-element in
the same PERFORM VARYING loop). Cell `k` is input variable `k` — the same
per-slot InputVar treatment stage 2a records use, but fixed-count and
subscript-addressed rather than READ-addressed. Layer A generates `n`
values; layer C solves per cell; layer D unions the table to one logical
region (flow-insensitive, like the record area).

**Stage O3 — OCCURS of a group; two-dimensional tables; a subscript that
is a general affine expression of a loop index (`W-VAL(I + 1)`).** The
element layout becomes a sub-layout (reusing 2b), and affine subscripts
stay decidable under the unroller.

**Out of scope (named, not silently dropped):** OCCURS DEPENDING ON
(variable length — needs the record-count machinery generalized), INDEXED
BY / SET / SEARCH (index registers and the search verbs), a subscript
that is a non-loop variable the unroller cannot pin to a constant, and
subscript bounds violations (COBOL's behavior is undefined; the envelope
excludes them, as 2b excludes malformed records).

## IR design

An elementary item gains an optional `occurs` count and, where it repeats
a group, an element `layout` (reusing the 2b slot vocabulary). A
subscripted reference lowers to a structured operand `{ table, subscript }`
rather than the opaque glued token it is today, so every layer sees the
access explicitly:

```json
{ "kind": "subscript", "table": "W-VAL", "subscript": { "text": "I", "refs": ["I"] } }
```

The frontend computes the count and element width; layer C recomputes and
asserts, as it does for records and redefines.

## Layer-by-layer plan

- **Layer B** — no changes; the real binary indexes the table.
- **Layer A** — O2: the table is `n` generated values (a fixed-length
  record vector), reusing the records generator with `min = max = n`.
- **Layer C** — the unroller drives the subscript to a constant `k`;
  `W-VAL(k)` resolves to cell `k − 1` (an env entry or InputVar). A
  literal subscript resolves immediately. A subscript that does not
  reduce to a constant is refused loudly (out of subset), never guessed.
  Accumulations over the table are the same per-cell affine sums layer C
  already solves (LEDGER's chains, stage 2a's record sums).
- **Layer D** — the table is one logical region: every `W-VAL(k)`
  reference derives from the table's cells, unioned flow-insensitively —
  symmetric with a Java `sum += vals[i]` over an array.
- **Certificates** — the envelope states the fixed bound `n` and the
  constant-subscript restriction (variable subscripts covered dynamically
  only, where applicable).

## Minimal implementation target for the next stage

Ship **O1 + O2** with one module: a fixed numeric table filled from input
and summed (and/or reduced with a ROUNDED per-element computation and a
threshold branch), so layer C has a real rounding/branch obligation per
cell. Candidate B carries a realistic table defect — an off-by-one bound
(`UNTIL I > n` mistranslated as `i < n`, dropping the last element, the
classic 1-based/0-based table migration bug) — caught by layer B on any
non-uniform table and by layer C's per-cell coverage.

## What this closes, and the one model behind it

The byte-layout vocabulary now underwrites all three corpus-head
data-shape epics — records (2b), REDEFINES, OCCURS — from a single model:
a layout is a list of typed byte slices; 2b reads one, REDEFINES overlaps
two, OCCURS repeats one. Subscript resolution rides the existing loop
unroller, so O1/O2 add no new solver surface — the same discipline that
kept every prior data-shape stage sound.

## Risks and decided trade-offs

- **Subscript decidability is the gate** — only literal and unroller-
  pinned subscripts are in subset; anything else is refused loudly. This
  is the OCCURS analogue of REDEFINES's "only one view written" quarantine.
- **Fixed bound only** — OCCURS DEPENDING ON is disclosed as out of scope
  until the record-count machinery is generalized to a symbolic table
  length.
- **Bounds violations excluded** — an out-of-range subscript is undefined
  in COBOL, so the envelope excludes it rather than certify a fiction, as
  2b excludes malformed records and REDEFINES excludes non-digit views.
