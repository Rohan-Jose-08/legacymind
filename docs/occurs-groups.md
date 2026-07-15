# OCCURS O3-flat — a group table is parallel per-leaf tables

Design and implementation for group-element OCCURS tables: the last
data-shape epic, and the construct gating the corpus's #2 rejection head
(stage 48 measured the 3,160 "MOVE target (qualified/subscripted)" bucket
as literal subscripts into not-yet-lowered tables — the table shapes were
the gap, not MOVE). Every claim below is validated against real
artifacts: GnuCOBOL 3.1.2 through `examples/probes/occurs-group.cbl`, the
ProLeap surface by live frontend runs, and the corpus population by
direct measurement of the pinned checkout.

## The corpus population is scaffold; the sound subset is real-world

Of the group-OCCURS declarations in the corpus, 165 are the NIST CCVS
`FILE-RECORD-INFO` block — a 10-element group table with **nested
subgroups**, VALUE-bearing FILLER template bytes (a formatted skeleton
string), elements initialized by **group-as-whole MOVEs**
(`MOVE FILE-RECORD-INFO-SKELETON TO FILE-RECORD-INFO (1)`), and whole
subgroups moved out for printing. The remainder is dominated by the
`GRP-ENTRY` family: triple-nested `OCCURS ... INDEXED BY` declarations —
the NIST multi-dimensional table-feature test series. Both demand the
heavy machinery (byte-layout × OCCURS composition, multi-dimensional
subscripting), and both are compiler-conformance scaffold.

The shape real business COBOL uses constantly — a **flat** group table
(rate rows, manifest lines: a few elementary leaves per element, written
and read leaf-wise) — appears in the corpus at roughly zero density.
As with the REDEFINES head (stage 43), the honest build targets the
real-world shape and names the scaffold shapes as residuals, rather than
building template-byte machinery to chase a test count.

## The decomposition — validated ground truth (GnuCOBOL 3.1.2)

**A flat group table with only elementary leaves, accessed only
leaf-wise, is semantically identical to parallel per-leaf tables**: `01 T
OCCURS N` with leaves `A`, `B` behaves exactly as `A OCCURS N` plus
`B OCCURS N`. Storage differs (interleaved vs parallel bytes), but no
construct in the subset can observe bytes — that is what the gates
guarantee. Probe results (`examples/probes/occurs-group.cbl`, byte-exact):

- **Leaf independence** — filling `W-CODE(1..3)`, `W-QTY(1..3)`,
  `W-PRICE(1..3)` leaf-wise and reading them back mixes nothing.
- **Qualified subscripted refs** — `W-QTY OF W-ROW (2)` reads cell 2 of
  the qty leaf (= `0020`).
- **Loop arithmetic over leaf cells** — `W-QTY(I) * W-PRICE(I)` summed
  over I gives exactly the parallel-table value (82.50 on the probe).
- **The excluded shape** — `DISPLAY W-ROW(2)` prints `BBB002000225`: a
  whole-element read is byte **concatenation** of the leaves. Admitting
  it would require the byte-layout × OCCURS composition; it is rejected
  loudly instead.

## ProLeap findings

- A group item's OCCURS clause arrives with its children already lowered
  (the stage-46 capture point), so the gate sees the full leaf list.
- Leaf references arrive as plain `LEAF(k)` — already the O1/O2x
  reference shape — with one wrinkle: **a qualified subscripted ref
  resolves with a space before the subscript** (`W-QTY OF W-ROW (2)` →
  `W-QTY (2)`), and a source-level space does the same. One
  canonicalization at the `resolveQualified` chokepoint
  (`canonicalizeSubscript`: collapse the space only when the whole text
  is a lone NAME(sub)) makes every base-name parser agree — frontend
  `isTableSubscript`, layer C `tableCell`, layer D's suffix strip.
  Expression texts, where " (" is meaningful, are never touched.

## The implementation — frontend-only, verifier untouched

`gateGroupOccurs` admits a group OCCURS item when every named leaf is
elementary unsigned-numeric or alphanumeric DISPLAY, with no nested
OCCURS or subgroup, no VALUE, and no REDEFINES; FILLER leaves are skipped
(dead storage — nothing in the subset can observe them). Each admitted
leaf then gets the ordinary `occurs` count and registers as **its own
logical table**; the group carries `occursGroup` for provenance only.
From that point the entire O1/O2x machinery applies unchanged: layer C's
`tableCell`/`store` resolve `LEAF(k)` cells (numeric cells solve, X cells
carry text), the unroller pins loop subscripts, and layer D unions each
leaf into one flow region matched by a modern parallel array.

**Whole-element access rejects loudly at every reference site** — the
`groupTables` registry catches `T(k)` and bare `T` in DISPLAY (checked
*before* the declared-ref and literal fallbacks: a group element read
must never become a silent literal, the finding-7 class), MOVE sources,
and MOVE targets; arithmetic already rejects non-lowered parenthesized
operands. Validated by negative probe: whole-element MOVE read, MOVE
write, and whole-table DISPLAY each reject with the specific reason.

## The module — MANIFEST (the 25th)

An order manifest: `W-ITEM OCCURS 3` mixing `W-SKU X(4)`, `W-PRICE
9(3)V99`, `W-QTY 9(3)V9`, `W-EXT 9(6)V99`. Skus and prices fill at
literal subscripts; quantities arrive by NUMVAL into subscripted COMPUTE
targets; a PERFORM VARYING loop writes each row's ROUNDED extension into
its own table cell (`W-EXT(I) = W-QTY(I) * W-PRICE(I)`), read back at
literal subscripts. Ground-truthed first: extensions tie at odd tenths
(all three rows tie at qty 0.1), the BIG boundary confirmed on the
binary. Candidate B carries the O3-specific defect — the per-row-storage
collapse (one shared quantity field, so every row prices from the last
quantity) — caught by layer B on every case with distinct quantities;
layer D is blind to it by design (same regions both sides).

Layer C verifies the per-row rounding obligation on both paths and
discloses two obligations honestly: the loop-condition boundary (the
documented JavaFlow/loop disclosure class, as in SETTLE) and the BIG
boundary over `W-EXT(1)+W-EXT(2)+W-EXT(3)` — a **three-input rounded
sum**, which is precisely the *multi-variable* solver depth named as
future work since the composed-rounding stage. TARIFF's tier verified
because its sum was single-input; MANIFEST now attaches a live module to
the multi-var residual.

## Named residuals (disclosed, not approximated)

- **Whole-element/whole-table access** (the CCVS skeleton idiom): needs
  the byte-layout × OCCURS composition — layout repeated per element,
  group moves as byte copies. The heavy epic, deliberately not built for
  a scaffold count.
- **Nested OCCURS / multi-dimensional tables** (the `GRP-ENTRY` family)
  and **INDEXED BY** (98): separate machinery, separate stage.
- **VALUE on table leaves**: initialization semantics not yet modeled;
  rejected loudly.
- **Multi-variable rounded-sum boundaries**: the MANIFEST disclosure —
  the next solver depth.
