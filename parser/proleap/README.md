# parser/proleap — the production parse engine

The ProLeap ANTLR4 COBOL 85 parser (grammar + reference-format
preprocessor) plus an ASG→IR lowering, selected from the CLI with
`legacymind parse <src> --engine proleap`.

## What it replaces

The TypeScript stub parser (`cli/src/parse`) was scoped to a bounded
subset from day one and scores 0/759 on the external corpus — almost
entirely on reference-format mechanics. ProLeap's preprocessor handles
those natively: fixed/variable/tandem source formats, column-7
indicators (comments, debug lines, `$` directives), continuation lines,
and COPY/REPLACE. Front-end acceptance on the same corpus: **737/759
(97.1%)**; the remainder are the corpus's own deliberately-broken error
fixtures. See `benchmark/parse-coverage.json`.

## Layout

- `src/ProLeapFrontend.java` — single-file frontend: parse, walk the
  ProLeap ASG, emit IR (`ir/schema.json`) as JSON on stdout. Compiled on
  demand by the CLI (`javac`, any JDK 17+); `--batch` mode parses one
  path per stdin line in a single JVM for corpus sweeps.
- `lib/` — committed jars: `proleap-cobol-parser` (MIT, built by JitPack
  from github.com/uwol/proleap-cobol-parser @ `d1bfe75b`), ANTLR 4
  runtime (BSD), SLF4J api/nop (MIT). Committed so parsing works offline
  and reproducibly; no build system or network needed.
- `classes/` — build output, gitignored.

## The two-tier honesty contract

Reported per file, never conflated:

1. **frontend** — the grammar + preprocessor accepted the source.
2. **IR-complete** — every construct was lowered into IR. Anything less
   returns `ok:false` with **every** unsupported construct enumerated
   (`FILLER item (line 12)`, `GO_TO statement (line 40)`, …). The corpus
   histogram of these is the prioritized lowering backlog; nothing is
   skipped silently.

## Stub parity

For sources inside the stub's subset both engines must emit identical IR
modulo `provenance` — same normalized statement text, same refs
extraction (`refsIn`), same JSON key order. This is load-bearing: the
transpiler replay cache is keyed on a provenance-stripped serialization
of the IR, so parity means the committed cache serves both engines.
Parity is cross-validated on all benchmark modules (payroll, interest,
discount); the benchmark runs `--engine proleap` end-to-end against real
GnuCOBOL.

Span provenance maps preprocessed lines back to original line numbers
(continuations merge upward; the mapping is exact or refused — a
COPY/REPLACE expansion that changes the line structure is reported as an
IR-stage failure rather than emitting wrong spans).

## Lowering wave 1 (2026-07-07)

Now lowered into IR (and proven end-to-end by the LEDGER benchmark
module, certified against real GnuCOBOL):

- **ADD / SUBTRACT / MULTIPLY / DIVIDE** — lowered to `compute`
  statements (one per receiving field, per-target ROUNDED); the
  statement `text` keeps the original verb for provenance. COBOL
  evaluates source operands once before storing, so a statement where a
  receiving field is also a source operand *and* there are multiple
  receivers is rejected, not mis-lowered. CORRESPONDING, ON SIZE ERROR,
  and REMAINDER stay rejected.
- **Period-terminated IF** — the ANTLR grammar resolves the dangling
  ELSE exactly as COBOL 85 does, so the ASG nesting is already correct.
- **Level-77** standalone items.
- **EXIT** — a no-op `exit` statement kind (flow-neutral in every
  verifier layer). EXIT PROGRAM stays rejected.
- **FILLER** — storage-only items with parser-synthesized names
  (`FILLER-n`, `filler: true`), never entered into the declared set.

## Backlog

- Control flow head of the histogram: GO TO, PERFORM
  TIMES/UNTIL/VARYING/THRU — these need the path-sensitive verifier
  engine (loops break layer C's path enumeration), not just parsing.
- REDEFINES (storage aliasing), qualified/subscripted references,
  OCCURS.
- File I/O statement family (OPEN/READ/WRITE/CLOSE) — arrives with the
  record/file trace-capture protocol.
- Rust IR core per the founding spec, behind the same JSON contract.
- Span mapping through COPY expansion (copybook-aware provenance).
