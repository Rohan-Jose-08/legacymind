# REDEFINES — aliased storage over the byte-layout model

Design for the REDEFINES epic: the single largest unlowered construct in
the corpus sweep (**4,326 instances** in `benchmark/parse-coverage.json`,
ahead of qualified/subscripted MOVE at 3,161 and the whole file-I/O
family). REDEFINES is the aliasing half of the byte-layout model that
file I/O stage 2b built (`docs/memory-layout.md`): 2b decodes one byte
range through one layout; REDEFINES decodes the *same* byte range through
*two*. This document designs the model. Every claim is validated against
real artifacts — GnuCOBOL 3.1.2 was probed through
`examples/probes/redefines.cbl`, and the ProLeap API surface was
confirmed by a live frontend run.

**Status:** stage **R1a is implemented and certified** (the DUES module).
The frontend gate admits the read-only, equal-width, numeric-over-numeric
subset and rejects every other shape with a specific reason; layer C
resolves a view read as the target's value at a shifted scale, and layer
D carries the same shift on the legacy side. R1b (cross-category) and R2
(write-through) remain designed-not-built below.

## What REDEFINES is

`02 B REDEFINES A` gives item `B` the *same storage* as the earlier item
`A` — a second typed view over one byte range. No bytes are added: `B`
overlays `A`'s offset and does not advance the record/group cursor. COBOL
requires `B` to be no larger than `A` (a smaller redefine is legal;
larger is not).

The layout vocabulary from stage 2b carries over verbatim — a view is
just a `LayoutSlot` list over the redefined range — with one change: the
layout is no longer a partition of the byte range but a *cover* with
overlap. Reading a view decodes its bytes; writing a view encodes into
its bytes; the other view then sees whatever bytes are physically there.

## Validated ground truth (GnuCOBOL 3.1.2)

Probe: `examples/probes/redefines.cbl` (build and run under the base
image, which has `cobc`). All three round-trip byte-for-byte:

- **Read-only reinterpretation** — `01 W-RAW1 PIC X(6) VALUE "015025"`
  read through `01 W-NUM1 REDEFINES W-RAW1 PIC 9(4)V99` decodes to
  `0150.25`, and `W-NUM1 * 2 = 300.50`. The six characters are
  reinterpreted as a numeric view with an implied decimal at scale 2.
- **Write-through** — `MOVE 42.75 TO W-NUM2` (a `9(4)V99`) makes
  `W-RAW2 REDEFINES W-NUM2 PIC X(6)` read `"004275"`; `MOVE 100.00`
  makes it `"010000"`. Writing the numeric view stores canonical
  zero-padded scaled digits, and the alphanumeric view reads exactly
  those bytes.
- **Group over group** — a `9(3)|9(4)V99` record holding 123 and 4567.89
  is `"123456789"`, and a `9(9)` view redefining it reads 123456789. A
  group redefine is byte reinterpretation, nothing more.

The soundness boundary is the same one 2b drew: a numeric view over
bytes that are not all digits is undefined (COBOL's DISPLAY and
arithmetic disagree, no error fires). The verified envelope is
well-formed bytes only.

## ProLeap

Confirmed by a live frontend run on the probe: every REDEFINES clause is
detected and currently rejected (`REDEFINES (line N)` for each). The
redefining item is an ordinary `DataDescriptionEntryGroup` sibling at the
same level as its target, carrying `getRedefinesClause()`;
`getRedefinesClause().getRedefinesCall()` names the target (resolvable
with the same `resolveQualified` machinery that already handles OF/IN).
The frontend's per-item `REDEFINES` rejection (ProLeapFrontend.java) is
the single gate to open.

## The central problem — aliasing in a name-keyed store

Layers B and D are nearly free; layer C is the whole difficulty, and it
is worth stating precisely.

Layer C's symbolic store is keyed by **data-item name**: `env.get("W-A")`.
Two REDEFINES views are two names over *one* storage cell. A write to one
name must be visible through the other — but the store has no notion that
`W-NUM2` and `W-RAW2` are the same bytes. Naively lowering both as
independent items silently breaks: writing `W-NUM2` leaves `W-RAW2`
stale. This is pointer aliasing, and it is why REDEFINES needs its own
stage rather than falling out of the 2b layout code for free.

The escape is to restrict, at first, to shapes where **only one view is
ever written** — then there is no aliasing *update*, only aliasing
*reads*, and an aliasing read is a pure reinterpret function of the
writer's value. That is the staged subset below.

## Staged sound subset

**Stage R1a — numeric-over-numeric reinterpretation, read-only view (the
minimal first implementation).** A numeric DISPLAY item redefined by
another numeric DISPLAY item of equal byte width, where the redefining
view is never a write target (never the LHS of MOVE/COMPUTE/ACCEPT/READ).
Same digits, different implied scale ⇒ the view's value is the target's
value shifted by the scale difference:

```
value(view) = value(target) * 10^(target.scale - view.scale)
```

This is a **pure decimal shift** — the exact operation layers C and D
already model (`shifts`), so R1a reuses existing machinery end to end and
introduces no new solver surface. Example: `05 W-CENTS PIC 9(6)` (an
integer count of cents) redefined by `05 W-DOLLARS REDEFINES W-CENTS
PIC 9(4)V99`, read for a money computation.

**Stage R1b — cross-category reinterpretation, read-only view.** `X(n)`
redefined by numeric, or numeric redefined by `X(n)`, read-only. The
reinterpret is the 2b decode/encode pair: encode the writer's value to
its canonical byte string, decode as the reader's view. Needs the
well-formedness contract (a numeric read of `X` bytes requires all
digits) — identical to the 2b malformed-record exclusion, stated in the
certificate.

**Stage R2 — write-through, one canonical direction.** Writing the
numeric view and reading the `X` view (`numeric → X`): the numeric
encoding is always valid `X`, so the aliasing update is total. Layer C
gains an alias map: a store to the writer view re-encodes and sets the
reader view's value. The reverse direction (`X → numeric`) is R2's unsafe
twin and stays out until the well-formedness of the written `X` can be
constrained.

**Out of scope (named, not silently dropped):** both views written and
read interleaved (true bidirectional aliasing); REDEFINES combined with
OCCURS; a redefining view that straddles a different group boundary than
its target; partial/overlapping redefines that are neither equal-width
nor cleanly nested.

## IR design

An item carries an optional `redefines` naming its (final, resolved)
target, and the layout model gains overlap: a redefining item's slots
share their target's `offset` and the cursor does not advance. For the
group case the file/record `layout` already expresses this once slots are
allowed to overlap; for a WORKING-STORAGE pair (the common case, no file)
the two items simply both carry an `offset`/`width` and a shared
`aliasGroup` id.

```json
{ "name": "W-DOLLARS", "redefines": "W-CENTS",
  "offset": 0, "width": 6, "decode": "num", "digits": 6, "scale": 2 }
```

The frontend computes the overlay (it already gates on the clause); layer
C recomputes from the DataItem tree and asserts equality, exactly as 2b
does for records — drift between the two is a build error.

## Layer-by-layer plan

- **Layer B** — no changes. It runs the real binary; bytes are bytes.
- **Layer A** — no changes for the read-only subset: REDEFINES is
  storage reinterpretation, not a new input. Generation feeds the writer
  (a stdin field, a VALUE, or a MOVE source) as today.
- **Layer C** — R1a: a read of the read-only view resolves to the
  target's `SymVal` scaled by `10^(target.scale - view.scale)` (a shift,
  emitted into the affine form directly). R1b: the read resolves through
  the 2b decode/encode reinterpret. R2: an alias map re-encodes on write.
  The recompute-and-assert layout guard carries over. No new solver
  machinery for R1a; R1b/R2 reuse the 2b encode/decode.
- **Layer D** — the two views share storage, so the redefining item's
  flow **is** the target's flow: a reference to the view derives from
  whatever derives into the target (plus the scale shift for R1a,
  symmetric with the modern side's explicit scaling — the same
  implied-decimal-as-shift move stage 2b made for record fields).
- **Certificates** — the coverage envelope names the well-formed-bytes
  contract (R1b/R2) and the read-only restriction (R1a).

## Minimal implementation target for the next stage

Ship **R1a** with one new module: a WORKING-STORAGE numeric field
redefined by a scaled numeric view, read-only, driving a money
computation with a ROUNDED boundary so layer C has a real obligation.
Candidate B carries a realistic REDEFINES defect — the classic
wrong-scale reinterpretation (treating the redefine as the same scale as
its target, i.e. dropping the implied decimal), which layers B and D both
catch (a value divergence and a missing decimal shift). R1a reuses the
shift machinery, so the stage is a frontend gate relaxation plus a small
Layer C/D resolution rule — cleanly completable and fully verifiable
against the real binary.

## What carries over from stage 2b, and forward to OCCURS

The `LayoutSlot` vocabulary, the width/offset computation, the canonical
encode/decode pair, and the well-formedness discipline all transfer
unchanged; REDEFINES only adds *overlap* and *aliasing*. OCCURS (the #9
head, 555) is the third consumer of the same layout model — a table is
the layout repeated `N` times with a subscript selecting the copy — so
the memory-layout model now underwrites three corpus-head epics from one
vocabulary.

## Risks and decided trade-offs

- **Aliasing is the hard part, and it is quarantined** — R1a/R1b write
  exactly one view, so there is no aliasing update; only R2 touches the
  alias map, and only in the always-sound `numeric → X` direction.
  Bidirectional aliasing is disclosed as out of scope, not approximated.
- **Well-formed bytes only** — inherited verbatim from 2b: a numeric view
  over non-digit bytes has no coherent reference semantics, so the
  envelope excludes it rather than certify a fiction.
- **Corpus shape distribution unmeasured** — the pinned checkout did not
  survive the session; the 4,326 count is from the committed
  `parse-coverage.json`, and the sub-shape split (read-only vs
  write-through, elementary vs group) is deferred to the next sweep. The
  staged subset is designed from GnuCOBOL semantics and first principles,
  not from a shape histogram, so this does not block R1a.
