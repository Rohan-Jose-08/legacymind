# The batch read loop — an artificial restriction, and the real one underneath

Stage 2a admitted exactly one shape of batch reader: the READ's paragraph
had to **be the target** of a `PERFORM UNTIL`.

```cobol
PERFORM READ-PARA UNTIL WS-EOF = 1        *> admitted
```

Every batch reader in AWS CardDemo writes it differently, and all five
write it *identically to each other*:

```cobol
PERFORM UNTIL END-OF-FILE = 'Y'           *> refused
    IF  END-OF-FILE = 'N'
        PERFORM 1000-CARDFILE-GET-NEXT
        IF  END-OF-FILE = 'N'
            DISPLAY CARD-RECORD
        END-IF
    END-IF
END-PERFORM
```

Same loop, with the READ one `PERFORM` deeper behind a redundant guard —
and since stage 76 hoists an inline body into a synthetic paragraph, the
loop's target is never the read paragraph at all.

## The shape restriction was artificial — measured

`examples/cdloop.cbl` is `BATCHSUM` restructured into the CardDemo idiom.
Against the real binaries, across the empty file, one record, three
records, six records and a truncating record, **CDLOOP and BATCHSUM agree
on every case**. The shape carries no semantics.

So the gate now asks the honest question — *is the READ driven by a
`PERFORM UNTIL`?* — by taking the **transitive closure of `PERFORM`
edges** from each loop's body, rather than demanding the loop target be
the read paragraph. Two loops reaching the same READ site is still
refused: the record stream has one loop context, not two.

## What the shape rule had been hiding

Removing the shape gate did not, on its own, make those modules
verifiable. It exposed what was actually in the way:

> **Layer C decides numeric conditions only.** CardDemo's end-of-file
> flag is `01 END-OF-FILE PIC X(01) VALUE 'N'`.

Layer C must decide the loop's exit condition to know the READ is not
re-entered after `AT END`. With an alphanumeric flag it cannot, so it
explores a further iteration, reaches the READ again, and refuses:
`layer C: READ after AT END on the same path`.

Swap the flag to `PIC 9` and nothing else — `examples/cdnum.cbl` — and
layer C proceeds. It even proves the two redundant guards are constant
(`condition decision value is constant on every feasible path`) and 19 of
23 paths infeasible. The nested guards do multiply paths, so the run fits
under `MAX_PATHS` at `records.max = 2` and exceeds it at 3; that is a
**scaling** bound, not a modelling failure.

| variant | flag | layer C |
|---|---|---|
| `BATCHSUM` (canonical) | `PIC 9` | verifies, as before |
| `CDNUM` (nested guards) | `PIC 9` | **completes**; guards proven constant |
| `CDLOOP` (nested guards) | `PIC X` | **refused**: READ after AT END — fixed below |

## The near miss

At that midpoint — shape gate removed, layer C not yet fixed — `assess`
reported **3 of 31 CardDemo modules VERIFIABLE**: this project's first
non-zero number on real third-party COBOL.

**It would have been false.** `assess`'s VERIFIABLE meant "full four-layer
verification and a signed certificate are available now", and layer C
refused all three. Publishing it would have been exactly the
confidently-incomplete instrument failure that stage 76 fixed in this same
tool.

The rule that came out of it, and that bit again later in this very stage:
**a frontend that ACCEPTS is not a pipeline that VERIFIES — when a change
moves the verifiable count, check what each layer will actually do before
believing it.**

## Built: the literal domain, and the regex that was hiding the problem

The design above predicted layer C needed a small "this variable holds one
of these literals" domain. It did. But the reason it could never decide
`END-OF-FILE = 'Y'` was smaller and more embarrassing: the expression
tokenizer had **no case for a quoted literal at all**.

```
/[A-Z][A-Z0-9-]*\([^)]*\)|[A-Z][A-Z0-9-]*|\d+\.\d+|\.\d+|\d+|[()+\-*/]/
```

`'Y'` matched the identifier alternative and became the bare name `Y`,
which resolved as a never-declared variable and went opaque. **Every
alphanumeric literal comparison in this engine's history has been silently
undecidable for that reason** — not by design, by omission.

With literals tokenized, plus:

- a `lit` value in the symbolic domain,
- alphanumeric `VALUE` clauses seeding it (so a flag declared
  `PIC X VALUE 'N'` is known at its first test),
- `MOVE` storing it **through the target's PICTURE** (truncate/space-pad,
  so `MOVE "YES"` into `PIC X` stores `"Y"`), and
- equality decided exactly, space-padded to the longer operand,

`CDLOOP` — the alphanumeric-flag shape — now behaves **identically** to
its numeric twin:

| | verdict | obligations | paths | witnesses |
|---|---|---|---|---|
| `CDNUM` (`PIC 9`) | PASS | 0 verified, 3 unrealized | 2/4 (+19 infeasible) | 2/23 |
| `CDLOOP` (`PIC X`) | PASS | 0 verified, 3 unrealized | 2/4 (+19 infeasible) | 2/23 |

**Only equality is decided.** Ordering between alphanumerics depends on
the collating sequence, which differs between the certified toolchain and
z/OS (`docs/charset.md`), so `<` / `>` stays undecided rather than
answered in the wrong character set — and the frontend still refuses a
read loop whose exit condition *orders* an alphanumeric.

### And `assess` now says which layers will run

Lifting the gate made `assess` report **3 of 31 CardDemo modules
verifiable** — the first non-zero number this project has produced on real
third-party COBOL. Stage 81's near-miss said to check what each layer
would actually do first, and the check bites again: all three carry
byte-modelled storage, so **layer C declines them** (`docs/byte-window.md`).

That is a documented, disclosed mode rather than a defect — but "verifiable"
had meant *full four-layer verification*, and for these three it is not.
So the frontend now emits **disclosures** alongside a successful lowering,
and `assess` splits the count:

```
verifiable now:   3/31 (9.7%)  [0 four-layer, 3 reduced evidence]

- CBACT02C.cbl — reduced evidence
  - layer C (symbolic) will not run: byte-modelled storage
    (IO-STATUS-04, TWO-BYTES-BINARY) - evidence comes from layers A, B and D
```

**Three verifiable, none of them with four layers, and the report says so
in the same breath as the number.**

## What this leaves

`CBACT02C`, `CBACT03C` and `CBCUS01C` lower completely and are verifiable
with **reduced evidence**: layers A, B and D, with layer C declining on
byte-modelled storage.

Nothing here has yet been **certified end to end**. That needs a VSAM
harness image per module and a `migrate` run, and until it happens the
honest line stays: *three modules are eligible, none is certified.*

Remaining work, in the order the evidence favours it:

1. **Certify one of the three for real.** Build the indexed-file image,
   run `migrate`, run A/B/D, issue the certificate with layer C recorded
   as not-run. That is the milestone, and it is now the only thing
   between this project and "your code, certified".
2. **A symbolic byte domain**, which would give layer C back on all three
   and turn reduced evidence into four-layer evidence.
3. **Path pruning for guards already proven constant** — the nested
   CardDemo guards are redundant and layer C can see it, but still pays
   for them (`MAX_PATHS` at `records.max = 3`).

## Probes

- `examples/cdloop.cbl` — `BATCHSUM` in CardDemo's idiom, alphanumeric
  flag: ground-truths the shape equivalence, and is the fixture that
  proves the literal domain decides the loop.
- `examples/cdnum.cbl` — the same shape with a numeric flag: isolated the
  flag as the cause, and is the twin `CDLOOP` now matches exactly.
