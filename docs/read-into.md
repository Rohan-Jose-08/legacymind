# READ ... INTO — the record is a buffer, the target is the layout

`READ f INTO x` is a `READ` followed by a group move of the record area
into `x`. VSAM V1 modelled that as per-leaf moves and required the record
and the target to align one-to-one. Real code does not work that way.

## The real shape, measured

The dominant idiom in AWS CardDemo: the FD record is a **coarse buffer**
and the target carries the real field structure. `CBACT02C`:

```cobol
FD  CARDFILE-FILE.
01  FD-CARDFILE-REC.
    05 FD-CARD-NUM    PIC X(16).
    05 FD-CARD-DATA   PIC X(134).        *> 150 bytes, 2 leaves

01  CARD-RECORD.                          *> the COPY'd target
    05 CARD-NUM             PIC X(16).
    05 CARD-ACCT-ID         PIC 9(11).
    05 CARD-CVV-CD          PIC 9(03).
    05 CARD-EMBOSSED-NAME   PIC X(50).
    05 CARD-EXPIRAION-DATE  PIC X(10).
    05 CARD-ACTIVE-STATUS   PIC X(01).
    05 FILLER               PIC X(59).   *> 150 bytes, 7 leaves
```

Same 150 bytes, different carving. And decisively: across `CBACT02C`,
`CBACT03C` and `CBCUS01C` the FD record's own fields are referenced
**zero times in the PROCEDURE DIVISION**. The record is nothing but a
landing area; all work happens through the target.

## Ground truth (GnuCOBOL 3.1.2, pinned container)

`examples/probes/readinto.cbl` — a coarse record (`X(4)` + `X(16)`) read
into a finer target of the same 20 bytes, input line
`AB120070123456Y_____`:

| target field | bytes | value |
|---|---|---|
| `D-KEY  PIC X(4)` | 0–3 | `AB12` |
| `D-QTY  PIC 9(3)` | 4–6 | `007` |
| `D-AMT  PIC 9(5)V99` | 7–13 | **`01234.56`** |
| `D-FLAG PIC X(1)` | 14 | `Y` |

The target's fields take their bytes **by offset**, implied decimals
included. That is precisely the stage-2b input decode
(docs/memory-layout.md) — so no new mechanism is required, only a
different layout source.

## The model

When a `READ ... INTO` target does not align leaf-for-leaf with the FD
record, **the target becomes the input layout**. The record stays a
flow-neutral buffer and no per-leaf moves are emitted; the target's
leaves are bound directly from the input bytes, exactly as record fields
are today.

Conditions, all checked and each rejected with its own reason:

- the target's total byte width must equal the record's — a different
  width is a different record, not a re-carving (a real `CBTRN02C` case
  reads a 300-byte record into a 240-byte target; COBOL truncates, we
  decline rather than guess);
- the FD record's own fields must not be referenced in the PROCEDURE
  DIVISION — otherwise both carvings are live at once and one layout
  cannot describe the input;
- the target's layout must be computable (the ordinary stage-2b rules).

**The one-to-one case is untouched.** Where record and target align leaf
for leaf, the existing per-leaf moves still apply, so `LEDGERX` and every
other certified file module keeps byte-identical IR — verified by
re-parsing and diffing `LEDGERX`, `REBATE` and `BATCHSUM`.

`READ ... INTO` was also restricted to INDEXED files by the VSAM stage;
that was arbitrary (the byte copy is identical for LINE SEQUENTIAL) and
is lifted.

## Measured effect

On CardDemo the leaf-mismatch blocker cleared for **5 modules**, and the
nearest realistic module `CBACT02C` went from 8 blockers to **7**. Median
across blocked modules stayed at 18.0, because removing this restriction
**unmasked** what sat underneath it:

- **signed numeric record fields** (`S` overpunches a byte) — a genuine
  stage-2b limitation, now visible on real records for the first time;
- READ paragraphs that are not `PERFORM` targets — a structural shape;
- the genuine width mismatch noted above.

VERIFIABLE remains 0/31.

## Probe

- `examples/probes/readinto.cbl` — coarse record, fine target, byte-offset
  carving with an implied decimal.
