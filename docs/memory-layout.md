# The memory-layout model — fixed-width records and byte views

Design for file I/O stage 2b (multi-field fixed-width records) and the
byte-layout groundwork it shares with REDEFINES — the two epics at the
head of the corpus sweep (REDEFINES is the top rejection at 4,326
instances; the file-I/O family follows close behind). Stage 2a (single-elementary-field records, the record
protocol) is live; this document designs the layout model before any
verifier code is written. Every claim below is validated against real
artifacts: GnuCOBOL 3.1.2 was probed through the committed programs in
`examples/probes/`, and the ProLeap API surfaces were confirmed by javap
and a live frontend run.

## Why a layout model

A multi-field record makes byte offsets semantic: `READ` deposits a line
into the record area, and each field is a fixed slice of it. REDEFINES
is the same primitive from the other direction: two typed views decoding
one byte range. Both reduce to:

```
LayoutSlot = { path, offset, width, decode }
decode     = unsigned-numeric(digits, scale) | alphanumeric(len) | filler
```

with `layoutOf(record)` computing widths postorder from PICTUREs and
offsets by running sum. The engine never needs a mutable byte array for
stage 2b: a record's bytes exist only at the READ boundary, where the
line is decoded once into per-field values. REDEFINES (later, its own
design stage) adds aliased *storage*; the slot/decode vocabulary is
identical.

## Validated ground truth (GnuCOBOL 3.1.2)

Probes: `examples/probes/layout1.cbl` (record slicing; run it under
`Dockerfile.infile`-style input) and `examples/probes/layout2.cbl`
(REDEFINES views). They are ground-truth probes, not lowerable modules
(layout1 uses an inline PERFORM the frontend rejects by design).

- **Widths**: numeric DISPLAY width = digit count; `V` and `S` occupy
  no byte (`S9(3)` is 3 bytes — sign is overpunched: -123 stores as
  `12s`); `X(n)` = n bytes; FILLER occupies its width; group = sum of
  children. A `9(3)|X(2)|9(4)V99|X(5)` record is 16 bytes and slices
  exactly at 0/3/5/11 — confirmed byte-for-byte.
- **Canonical decode**: full-width lines decode every field exactly;
  `001234` under `9(4)V99` is 12.34; arithmetic agrees with DISPLAY.
- **Short lines are space-padded** into the record area. A missing
  suffix that covers only alphanumeric fields is well-defined (spaces).
  A **partially-filled numeric field is undefined garbage**: `0012  `
  under `9(4)V99` DISPLAYs as `0012.00` but *adds as 10.24* — DISPLAY
  and arithmetic decode differently. All-spaces numeric fields added
  95516.00 to a total. Non-digit bytes produce garbage arithmetic with
  **exit code 0** — no runtime error surfaces any of this.
- **Long lines truncate silently** to the record width.
- **REDEFINES round-trips**: `X(6) VALUE "001234"` read through a
  `9(4)V99` view is 12.34; writing 56.78 through the numeric view makes
  the raw view `005678`. The byte model predicts both directions.
- **ProLeap**: multi-field FD records already lower structurally — the
  live frontend run rejects them *by counting the record's fields*, so
  the children arrive with PICTUREs through the existing
  `lowerDataItem` path (same code that lowers WORKING-STORAGE groups).
  FILLER naming is already synthesized. `getRedefinesClause()` /
  `getRedefinesCall()` expose the REDEFINES target;
  `getOccursClauses()`, `getSignClause()`, `getJustifiedClause()`,
  `getSynchronizedClause()`, `getBlankWhenZeroClause()` make every
  layout-perturbing clause visible for gating (all confirmed by javap).

## The well-formed-record contract

The undefined cases above force the central design decision: **the
verified envelope is well-formed records only** — every line exactly
`recordWidth` bytes, numeric fields all digits, alphanumeric fields
free. The generator emits only such lines; curated cases must comply
(checked, loudly). The certificate states the exclusion explicitly:
malformed records (short/long lines, non-digit bytes in numeric fields)
are outside the envelope because GnuCOBOL itself has no sane semantics
there — DISPLAY and arithmetic disagree about the same bytes and
nothing errors. This is refusing to certify what the reference
implementation cannot define, not a shortcut.

## Stage 2b sound subset

Everything in the 2a gate stays (one LINE SEQUENTIAL input file, one
READ site heading one top-level PERFORM UNTIL body, no ACCEPT), with
the record relaxed:

- the FD record may be a group; leaves are unsigned numeric DISPLAY
  (`9(n)` / `9(n)V9(m)`), `X(n)`, or FILLER; nested subgroups fine;
- rejected per-leaf, loudly: `S` (overpunch bytes), editing pictures,
  non-DISPLAY usage, OCCURS, REDEFINES, SIGN/JUSTIFIED/SYNCHRONIZED/
  BLANK WHEN ZERO, P scaling;
- the group record itself may not be referenced in the PROCEDURE
  DIVISION (no `MOVE IN-REC`, no `DISPLAY IN-REC`) — field references
  only; group references are stage 2c candidates (the raw line is
  available in principle: it is the concatenation of the slot
  encodings);
- FILLER slices are storage-only, as everywhere else.

## IR design

No new statement kinds. The input file's entry gains the computed
layout, single source of truth for every layer and for the candidate
contract:

```json
{ "name": "IN-FILE", "assign": "in.dat", "organization": "line-sequential",
  "record": "IN-REC", "mode": "input", "recordWidth": 16,
  "layout": [
    { "path": "IN-REC.F-ID",  "offset": 0, "width": 3, "decode": "num", "digits": 3, "scale": 0 },
    { "path": "IN-REC.FILLER-1", "offset": 3, "width": 2, "decode": "filler" },
    { "path": "IN-REC.F-AMT", "offset": 5, "width": 6, "decode": "num", "digits": 6, "scale": 2 },
    { "path": "IN-REC.F-NAME", "offset": 11, "width": 5, "decode": "alnum" } ] }
```

The frontend computes it (it already gates on the record's shape);
layer C recomputes from the DataItem tree and asserts equality — drift
between the two computations is a build error, not a silent divergence.
Emitting `layout` for input files re-keys the replay cache for BATCHSUM
(IR content change, by design); the failure is loud and the fix is the
standard re-record of its two candidates.

## Layer-by-layer plan

- **Layer B** — no changes. The wrapper is content-agnostic (validated
  in 2a); lines in, KV out.
- **Layer A** — the records generator becomes layout-driven: each
  record draws one value per non-filler slot from its PICTURE (the
  existing seeded, small-value-biased generation), encodes at offsets
  (numeric = zero-padded scaled integer, alnum = space-padded, filler =
  spaces), and emits exactly `recordWidth` bytes. Shrinking drops
  records first (unchanged), then shrinks fields individually.
- **Layer C** — slot (k, j): record k's non-filler leaf j is one
  InputVar; READ at depth k binds all of record k's leaves at once (the
  fork on the record count R is exactly stage 2a's). Numeric leaves are
  exact rationals with PICTURE-bounded ranges; **alphanumeric leaves get
  today's alphanumeric-stdin treatment** — carried at their base/
  generated values, skipped by every solver (witness repair, boundary
  inversion, congruence seeding, staircase all already guard on
  `spec.numeric`), so conditions over them fall to the fuzz belts and
  layers A/B. `toStdin` renders a path with count k as k full-width
  lines through the slot encodings — canonical and injective, so a
  solved witness is a byte-exact case. Paths multiply only through R,
  as in 2a; the variable count grows to R×F, bounded by maxRecords and
  the existing MAX_PATHS guard.
- **Layer D** — the record stays **one logical input position**: every
  field reference reads it. The Java side's single `readLine` feeding
  per-field substring parses unions to the same position by
  construction, so summaries stay symmetric. This granularity cannot
  see a candidate that swaps two same-typed fields — that is a value
  bug, and layers B and C catch it (a design-stage candidate-B idea).
  Field-granular flow (substring offset tracking in JavaFlow) is a
  named future refinement, not silently promised.
- **Certificates** — coverage envelope adds the well-formed-record
  contract sentence and the record-count bound from 2a.

## Config shape

Stage 2a configs are untouched (`records: {domain, max}` + scalar
baseCase). A multi-field module's config drops `domain` (each leaf's
PICTURE bounds its own domain) and gives baseCase as **raw full-width
lines**, decoded through the layout — human-readable, byte-exact, and
the natural home for X-field content:

```json
"symbolic": { "ir": "...", "records": { "max": 12 },
  "baseCase": ["012xx001234Alice", "034yy005000Bobby"] }
```

## Candidate contract (Java side)

The layout block is the parsing spec: `line.substring(offset,
offset+width)` per field, numeric via `new BigDecimal(slice)` scaled by
`scale` — and the candidate assumes well-formed lines, same as the
certificate envelope. JavaFlow rules unchanged (single-site read loop,
helpers for file work, no try-with-resources in main).

## What carries over to REDEFINES

The slot/decode vocabulary, the width computation, the canonical
encode/decode pair, and the well-formedness discipline. REDEFINES adds
aliased storage (writes through one view visible to the other — probed
and confirmed), which needs its own design stage: view-consistency in
layer C is a real engine problem (a write through `X(6)` then a read
through `9(4)V99` is only sound when the written bytes are a canonical
numeric encoding — the same well-formedness contract, applied to MOVEs
instead of records). The decode functions and their injectivity
arguments transfer verbatim.

## Risks and decided trade-offs

- **Cache re-key on BATCHSUM** — accepted; loud failure, standard
  re-record.
- **X fields unsolved** — disclosed, matches existing alphanumeric
  handling; a module whose control flow branches on an X field will
  show unsolved paths in the coverage report rather than fake
  witnesses.
- **Record-granular Layer D** — disclosed above; field-swap defects are
  layer B/C's to catch.
- **Malformed records excluded** — the strongest version of "prefer
  refusing over mis-answering" in the product so far: the reference
  semantics are self-contradictory there (probe P1c), so no correct
  certificate can include them.
