# OCCURS INDEXED BY — an index-name is an occurrence-number variable

Design and implementation for `OCCURS ... INDEXED BY` index-names and the
`SET` statements that drive them. The corpus population is measured and
mostly scaffold, as usual; the buildable slice is the everyday
index-driven table idiom, and it reuses the existing machinery entirely.

## The corpus population, measured

There are 73 `INDEXED BY` declarations in the corpus, but only ~4 are
**flat** elementary tables — the rest are the `GRP3-ENTRY` NIST
multi-dimensional series (nested `OCCURS ... INDEXED BY` inside
`OCCURS ... INDEXED BY`, so `TABLE-1(INXEX1 INXEX2 INXEX3)` is a 3-D
table leaf) and group tables. And index-names are exercised mainly by
`SEARCH`/`SEARCH ALL` (148 uses across the corpus) and relative
multi-subscripting (`TABLE-1(INXEX2 + 1  INXEX3 + 1)`). So the corpus
over-represents the *multi-dimensional* and *search* forms — both far
larger constructs than a single index-name.

The genuine 1-D idiom — a table walked by an index the program `SET`s and
subscripts with — is under-represented in this conformance corpus but
ubiquitous in real pre-modern COBOL (it is how tables were processed
before `PERFORM VARYING` and inline `PERFORM` were common). So, as with
the data-shape epics, the honest build targets the real-world shape and
names the multi-dimensional and `SEARCH` forms as residuals.

## The model — validated ground truth (GnuCOBOL 3.1.2)

An index-name holds an **occurrence number** (a 1-based position). At the
source level, nothing in the subset touches its byte representation, so it
is exactly an integer variable that names a table position.
`examples/probes/indexed.cbl` confirms byte-for-byte:

- `SET IDX TO n` makes `IDX` refer to occurrence `n` — a plain assignment
  (`SET IDX TO 2` then `W-VAL(IDX)` reads occurrence 2).
- `SET IDX UP BY m` adds `m` to the occurrence number.
- `TABLE(IDX)` reads occurrence `IDX`, and a `SET`-driven walk sums the
  same values as literal-subscript access (both `150`).

So the desugar is exact: `SET idx TO n ≡ MOVE n TO idx`, `SET idx UP BY m
≡ COMPUTE idx = idx + m`, over a synthetic numeric item — no bytes, no
new semantics.

## The implementation — frontend-only, verifier untouched

- **Registration** (`registerIndexName`): each `INDEXED BY` name becomes a
  synthetic elementary unsigned-numeric `PIC 9(4)` DISPLAY item, injected
  as a top-level data item before name finalization so it enters
  `declared` and resolves like any numeric variable (`SET` writes it,
  subscripts read it, the unroller pins it). `INDEXED BY` is parsed as an
  *additional* clause on a fixed table — the earlier gate wrongly treated
  it as an alternative to the count — while the table's own element shape
  is still gated by O1/O2x/O3-flat.
- **`SET` desugar**: `SET idx TO n` emits the same `move` IR a normal
  assignment does; `SET idx UP/DOWN BY n` emits a `compute` `idx = idx ±
  n`. Both land on the synthetic numeric item, so Layer C's `store` and
  `tableCell` and Layer D's flow handle them with **zero changes** — the
  RG/O2x/O3-flat leverage once more. The 88-level `SET ... TO TRUE` path
  is preserved exactly (existing modules stay byte-identical); a `SET` on
  any non-index, non-condition target is rejected loudly.

An index used as a `PERFORM VARYING` loop variable is pinned by the
existing unroller; an index `SET` to a constant (directly or via `UP BY`)
is constant-folded, so `TABLE(idx)` resolves to a definite cell in both
cases.

## The module — REORDER (the 26th)

A reorder cost over `WS-PRICE PIC 9(3)V99 OCCURS 5 INDEXED BY PX`: the
price table is filled at literal subscripts and summed by `PERFORM
VARYING PX` (index as loop variable); `SET PX TO 1` then `SET PX UP BY 2`
selects occurrence 3 by relative indexing; the base cost `WS-QTY *
WS-PRICE(PX)` is ROUNDED, and the 5% reorder fee is ROUNDED on that base.
Ground-truthed against the real binary first (base tie realization, the
500.00 BULK boundary). Candidate B makes the `SET UP BY` off by one
(occurrence 2, not 3) — the index-arithmetic defect — caught by layer B
on every non-zero quantity.

Layer C verifies both roundings and the tier, and as a bonus exercises
the composed-rounding solver: the fee is `round2(0.05 · round2(price ·
qty))`, a round over a rounded base — the RETAIL shape — realized through
the composed congruence. The one remaining disclosure is the `PERFORM
VARYING` loop-condition boundary (`IF PX > 5`), the documented
loop-condition class shared with MANIFEST and SETTLE. Layer A 200/200,
layer D 6/6.

## Named residuals (disclosed, not approximated)

- **Multi-dimensional / nested INDEXED BY tables** (the `GRP3-ENTRY`
  series) and relative multi-subscripting: need the multi-dimensional
  table model (nested OCCURS), still rejected.
- **`SEARCH` / `SEARCH ALL`**: a separate construct (linear and binary
  table search over an index); not addressed here.
- **`SET idx TO another-idx` / index in non-subscript arithmetic**:
  outside the assignment/adjustment subset; rejected loudly.
