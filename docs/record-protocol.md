# The record protocol — verifying file-READING batch programs

Design for file I/O stage 2 (input files). Stage 1 (one LINE SEQUENTIAL
output file) shipped with the PAYSLIP module; this document designs the
input side — the `READ ... AT END` batch archetype — before any verifier
code is written. Every claim below is validated against real artifacts:
the ProLeap API was probed, GnuCOBOL semantics were ground-truthed
through the committed prototype, and the harness input contract is
already implemented and proven.

## Why READ is not ACCEPT

The verifier's input model today is a fixed list of stdin positions:
every path of every case reads the same inputs in the same order. READ
breaks all three assumptions at once:

1. **Variable count** — a case is a *file* of N records, N differing per
   case (including N = 0).
2. **Iteration dependence** — the k-th READ consumes the k-th record, so
   input positions are indexed by loop depth, exactly the shape the
   ACCEPT-in-loop rejection exists to keep out of the engine.
3. **EOF is control flow** — `AT END` turns input exhaustion into a
   branch, making the record count itself a symbolic quantity that
   decides path feasibility.

## Validated ground truth

Probes are reproducible: `examples/batchsum.cbl` built with
`harness/gnucobol/Dockerfile.infile` (both committed).

- **Harness input contract works**: the wrapper turns the case's entire
  stdin into the input file (`cat > in.dat`), then runs the program.
  stdin lines in = file records; KV lines out. Verified: 3 records sum
  to 35.75; a single record; **an empty stdin yields COUNT=0 (AT END
  fires on the first READ)**; 200 records of 1.00 total 200.00.
- **GnuCOBOL semantics**: LINE SEQUENTIAL READ delivers one line per
  record, space-padded into the fixed-size record (NUMVAL of a short
  line works); AT END executes its phrase and leaves the record area
  alone; re-running in a persistent container is safe because the
  wrapper rewrites the file from scratch each run.
- **ProLeap API** (`ReadStatement`): `getFileCall()` names the file;
  `getAtEnd()` / `getNotAtEndPhrase()` are `Scope`s (statement lists,
  like WHEN phrases); `getInto()` is the READ INTO variant; `getKey()` /
  `getInvalidKeyPhrase()` mark indexed reads. All the rejection
  surfaces are visible.

## The protocol

One case = one input file = the case's stdin lines, in order. The
observable stream stays exactly what it is today (KV lines on stdout),
so layers A and B need no comparison changes — only case *generation*
learns about records. A module may combine an input file with an output
file (stage-1 wrapper serializes the output file after stdout); it may
not combine file input with ACCEPT in stage 2a.

## IR design

New statement kind:

```json
{ "kind": "read", "file": "IN-FILE",
  "atEnd": [ ...statements... ], "notAtEnd": [ ...statements... ],
  "text": "...", "span": {...} }
```

`files[]` entries gain `"mode": "input" | "output"`. The FD record
lowers into ordinary storage exactly as stage 1 does.

## Sound subset, staged

**Stage 2a (the next implementation stage):**
- exactly one input file, LINE SEQUENTIAL, literal ASSIGN;
- the FD record is a single elementary field (one line = one value, so
  a record is symbolically identical to an ACCEPT-ed input);
- exactly one READ site, and it is the first statement of the body of
  one top-level `PERFORM UNTIL` loop (the canonical archetype);
- no ACCEPT anywhere in the module (stdin belongs to the file);
- READ INTO / KEY / INVALID KEY / NEXT RECORD rejected; a second READ
  site rejected; OPEN modes other than INPUT for that file rejected.

**Stage 2b:** multi-field fixed-width records — needs reference-
modification/substring semantics in the engine (fields = slices of the
line), shared groundwork with REDEFINES.

**Stage 2c:** READ INTO (sugar for READ + MOVE), multiple files,
ACCEPT-then-file mixed input (header parameters before the record
stream, with an explicit separator contract).

**Out of scope until the keys/index epic:** indexed and relative
organizations, START, REWRITE.

## Layer-by-layer plan (stage 2a)

- **Layer B** — no changes. Cases carry records as stdin lines; the
  wrapper does the rest. Curated cases must include N = 0 (the AT-END-
  first edge, validated above) and N = 1.
- **Layer A** — propgen gains a records mode: `generator.records =
  { "field": "IN-REC", "min": 0, "max": 25 }`. Each generated case
  draws a count N in [min, max] (biased toward 0, 1, and max, the
  small-value bias applied per record), then N record values from the
  field's PICTURE. Seeded and shrinkable like today.
- **Layer C** — the record count R becomes a bounded symbolic dimension
  rendered through the existing unroller. Record slot k is an input
  variable (position = k, after none since ACCEPT is excluded). The
  single READ site, met at unroll depth k, forks exactly like a loop
  test: the NOT AT END arm carries constraint R > k and binds the
  record area to slot k; the AT END arm carries R = k. A path that
  exits after k iterations is realized as a case with exactly k stdin
  lines (`toStdin` emits R lines, so assignments become variable-
  length). MAX_PATHS and maxLoopUnroll bound the exploration, and the
  beyond-bound region keeps today's honest disclosure (poisoned writes,
  unknown coverage). Witness repair, boundary inversion, congruence
  seeding, and the staircase all operate per-slot unchanged — a slot is
  just an InputVar.
- **Layer D** — flow-insensitive as ever: the record field is one
  logical input position (the loop unions all iterations). On the Java
  side the single in-loop `readLine` already counts as one position, so
  the comparison stays symmetric. Totals/accumulators union the record
  input with their constants exactly like loop-carried flows today.
- **Certificates** — the coverage envelope states the record-count
  bound explicitly: "paths cover files of 0..k records; larger files
  are exercised dynamically by layers A and B only."

## Config shape (stage 2a)

```json
"symbolic": {
  "ir": "...", "recordField": "IN-REC", "maxRecords": 12,
  "baseCase": ["10.50", "20.25", "5.00"]
}
```

`stdinFields` and `records` are mutually exclusive; the runner and
certify treat them identically downstream.

## Risks and decided trade-offs

- **Path growth**: R multiplies paths by up to maxRecords. The existing
  MAX_PATHS guard and eager infeasibility pruning apply; modules with
  branching inside the loop body may need a lower bound. Disclosed, not
  hidden.
- **Accumulator obligations**: totals over R records give per-depth
  affine sums — the same shape LEDGER's accumulator chains already
  solve. Rounding-inside-loop obligations realize at the earliest
  depth, as today.
- **Empty-file candidates**: the N = 0 case is where hand-written Java
  most often diverges (uninitialized totals, missing headers). It is a
  mandatory curated case.
- **Record padding**: LINE SEQUENTIAL pads short lines into the record
  area. With single-field elementary records and NUMVAL this is
  behavior-neutral (validated); multi-field records inherit it as a
  stage 2b concern.
