# VSAM / INDEXED files — the sequential batch read

Design for `ORGANIZATION IS INDEXED` files: the **largest single blocker
cluster in real COBOL** (docs/real-code-assessment.md — `OPEN`/`CLOSE`/
`READ INTO` of a non-lowered file affect ~15 of the 20 blocked real
modules). This is a design stage: the corpus shapes are measured, the
GnuCOBOL semantics are validated against the pinned container, and the
harness crux is hand-built end-to-end before any engine code.

**Honest scope note.** VSAM is the biggest cluster, not a silver bullet.
The median blocked CardDemo module carries 26 distinct blockers; lowering
INDEXED files removes one theme from that list, it does not flip a real
module to VERIFIABLE on its own. The goal is a sound, certified
INDEXED-file benchmark module and a measurably shorter real-code blocker
table.

## The corpus population, measured

From the 14 CardDemo modules that parse (the batch half — the CICS half
never reaches this analysis):

| clause | count |
|---|---|
| `ORGANIZATION IS INDEXED` | 31 |
| `ACCESS MODE IS SEQUENTIAL` | 22 |
| `ACCESS MODE IS RANDOM` | 17 |
| `RECORD KEY IS` | 18 |
| `FILE STATUS IS` | ~20 (every indexed SELECT) |
| `ALTERNATE RECORD KEY` | 0 |

Verb population in the same modules:

| verb | count |
|---|---|
| `WRITE ... FROM` | 104 |
| `OPEN INPUT` | 30 |
| `READ ... INTO` | 24 |
| `READ` (plain) | 18 |
| `OPEN OUTPUT` | 15 |
| `INVALID KEY` | 12 |
| `START` | 9 |
| `REWRITE` | 6 |
| `OPEN I-O` | 3 |

Two things stand out. **`ACCESS SEQUENTIAL` + `OPEN INPUT` + `READ INTO`
+ `FILE STATUS` is the dominant batch idiom** — it is the CBACT01C shape,
a read-every-record report loop:

```cobol
1000-ACCTFILE-GET-NEXT.
    READ ACCTFILE-FILE INTO ACCOUNT-RECORD.
    IF  ACCTFILE-STATUS = '00'
        ...
```

And **`FILE STATUS` is checked explicitly, not `AT END`** in much real
code — the loop tests the two-character status variable against `'00'`
and `'10'`. Any lowering that only understands `AT END` misses the real
idiom.

## Ground truth, validated (GnuCOBOL 3.1.2, pinned container)

The pinned image **does** support INDEXED — the indexed file handler is
**BDB** (Berkeley DB), and the file is a *single* `/tmp/x.dat` artifact
with no separate index file. Probes: `examples/probes/vsam-*.cbl`.

Predictions were written before each run; one was wrong and the
correction is recorded below.

**Iteration order is the index, not insertion** (`vsam-dynamic.cbl`).
Under `ACCESS DYNAMIC`, records written in order `KEY03, KEY01, KEY02`
come back from sequential `READ NEXT` as:

```
SEQ=KEY01/100   SEQ=KEY02/200   SEQ=KEY03/300
```

This is the semantic the whole stage rests on, and the one a naive
migration gets wrong.

**Status codes**, all measured:

| situation | status |
|---|---|
| successful `OPEN` / `READ` / `WRITE` | `00` |
| sequential read past the last record | `10` |
| `OPEN INPUT` of a nonexistent file | `35` |
| duplicate `RECORD KEY` on `WRITE` (DYNAMIC) | `22` |
| keyed `READ` for a key not present | `23` (`INVALID KEY` fires) |
| out-of-sequence `WRITE` under `ACCESS SEQUENTIAL` | `21` |

**The `21` case is a trap worth naming.** Under `ACCESS SEQUENTIAL` +
`OPEN OUTPUT`, records **must** be written in ascending key order; a
violation returns `21` **and the record is silently dropped** — the
program continues. A first probe wrote keys out of order under
`ACCESS SEQUENTIAL` and ended up with a one-record file while every
`WRITE` "succeeded" from the program's point of view. (That probe also
made me predict `22` for a duplicate key where the answer was `21`:
out-of-sequence dominates. The duplicate `22` was only reproducible once
the write path used `ACCESS DYNAMIC`.) Any loader that builds an indexed
file must therefore either use `ACCESS DYNAMIC`/`RANDOM` or pre-sort.

**`READ INTO`** is `READ` followed by a move of the record area into the
target: after `READ ACCTF INTO HOLD-REC`, both `HOLD-REC` and the FD
record area hold the record. Confirmed directly.

## The harness contract — and the crux, hand-built

An INDEXED input file is a **binary BDB artifact**. The legacy side reads
it natively; the Java side cannot and must not pretend to. So the
observable contract cannot be the file — it has to be the logical record
set, supplied identically to both sides:

```
stdin seed (one text record per line, ARBITRARY order)
   │
   ├── legacy:  seed.txt ──> LOADER (ACCESS DYNAMIC) ──> acct.dat (BDB)
   │                                                       │
   │                                     module under test ┘ reads INDEXED,
   │                                                         gets KEY order
   └── modern:  parse seed ──> sort by key ──> iterate
                                     │
                          both emit the same KV stream
```

The loader is **harness infrastructure, never under verification** — it
exists only to materialise the file, exactly as the file-serializing
wrapper exists to observe one. The equivalence claim is: *given the same
logical record set, both implementations agree* — with the index's
key-ordering semantics modelled explicitly on the modern side (which is
precisely what a real VSAM→RDBMS/sorted-map migration must do).

**This was hand-built and run before writing any engine code.** A
`LOADER` + `LEDGERX` pair compiled in the pinned container, seeded
deliberately out of key order (`B0002, A0001, C0003`):

```
LOADED=003
COUNT=003   TOTAL=0001599.75   FEE=00024.00
FIRST=A0001   LAST=C0003   TIER=STD
```

`FIRST=A0001` with a seed that began `B0002` is the proof: the key
ordering survives the whole pipeline. Arithmetic checks by hand
(1599.75 total; 1599.75 × 0.015 = 23.99625 → ROUNDED `24.00`).

`FIRST`/`LAST` are deliberately in the output because they **expose
iteration order as an observable**. A Java candidate that iterates the
seed in insertion order reports `FIRST=B0002` and is caught on every
unsorted case — the defect this module exists to catch.

## The sound subset — V1

**Accepted:**

- `SELECT ... ASSIGN TO <literal> ORGANIZATION IS INDEXED ACCESS MODE IS
  SEQUENTIAL RECORD KEY IS <field-of-the-record> FILE STATUS IS <ws-2-char>`
- `OPEN INPUT` / `CLOSE`
- `READ <file> [INTO <target>] [AT END ...] [NOT AT END ...]`
- `FILE STATUS` maintained as an ordinary WORKING-STORAGE `PIC XX` after
  every operation (`00`, `10`, `35`) so the real
  `IF status = '00'` idiom lowers as an ordinary comparison — no new
  condition machinery.
- Record layout: the FD record is the existing stage-2b byte-layout model
  (fixed-width fields, DISPLAY usage) — INDEXED records are fixed-length,
  so the existing decoder applies unchanged.

**Enumerated residuals (rejected loudly, named in `assess`):**

- `ACCESS RANDOM` / `DYNAMIC`, keyed `READ`, `INVALID KEY` (needs the
  key-lookup model — the natural V2)
- `START` / browse positioning; `REWRITE`; `DELETE`; `OPEN I-O` / `EXTEND`
- `WRITE` to an indexed file (the `21`/`22` ordering semantics above
  make this its own design question)
- `ALTERNATE RECORD KEY` (absent from the corpus; zero occurrences)
- Non-literal `ASSIGN TO` (a ddname resolved by JCL) — real code uses
  this constantly and it is a *deployment* binding, not a semantic one;
  it needs an explicit mapping input, deferred with intent
- `RECORD KEY` that is not a contiguous field of the record

## Layer impact

- **Frontend** — the real work: `OrganizationClause.getMode() == INDEXED`,
  `AccessModeClause.getMode() == SEQUENTIAL`, `RecordKeyClause
  .getRecordKeyCall()`, `FileStatusClause.getDataCall()` are all exposed
  by the ProLeap ASG (verified by `javap`); `ReadStatement` exposes
  `getInto()`, `getAtEnd()`, `isNextRecord()`, `getKey()`,
  `getInvalidKeyPhrase()`. The file model gains an `organization:
  "indexed"` kind with `recordKey` and `fileStatus` bindings.
- **IR / ir-core** — a new file organization value and a status-variable
  binding; `StmtKind` unchanged (`read` already exists).
- **Layer C** — the read loop is a bounded iteration over the record set,
  same as today's sequential-file loops; the *arithmetic* obligations
  (the ROUNDED fee, the tier boundary) are ordinary. Expect the loop
  condition itself to remain in the documented loop-condition disclosure
  class.
- **Layers A / B / D** — nothing new: the KV stream is still the single
  observable; the seed is ordinary stdin.

## Build plan

1. Harness: `Dockerfile.indexed` — wrapper writes stdin to `seed.txt`,
   runs the compiled loader, then the module; loader source lives with
   the harness, not the module.
2. Frontend: lower the V1 subset; every excluded shape above rejects with
   its own message.
3. Module `LEDGERX` (28th): candidate A faithful (sorted iteration);
   candidate B iterates in seed order — caught by `FIRST`/`LAST` on every
   unsorted case.
4. Gates: benchmark 28/28 with the prior 27 byte-identical; re-run
   `assess` on CardDemo and record the blocker-table delta (the honest
   measure of whether this stage bought real-code reach).

## Probes

- `examples/probes/vsam-basic.cbl` — INDEXED support, `ACCESS SEQUENTIAL`
  write ordering (`21`), sequential read, `AT END` = `10`.
- `examples/probes/vsam-status.cbl` — missing file (`35`), `READ INTO`
  semantics, status after end.
- `examples/probes/vsam-dynamic.cbl` — key order vs insertion order,
  duplicate key (`22`), keyed read, missing key (`23`).
- `examples/probes/vsam-loader.cbl` / `examples/probes/vsam-ledgerx.cbl` —
  the hand-built harness crux.
