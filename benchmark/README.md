# benchmark/ — the public benchmark

## Purpose

A reproducible, end-to-end benchmark of the whole pipeline: multiple COBOL
modules parsed, migrated to Java 21, verified on four independent layers
**against the real GnuCOBOL binary in the sandboxed harness**, and
certified. Plus an honest parser-coverage sweep over an external corpus.
Results: `RESULTS.md` / `results.json` (committed snapshots).

The LEDGER module is deliberately outside the stub parser's subset
(arithmetic verbs, level-77 items, period-terminated IFs with a dangling
ELSE, EXIT, FILLER): it parses only with the proleap engine and proves
the wave-1 lowering end-to-end. Its candidate B carries a HALF_EVEN
banker's-rounding defect — the "idiomatic Java default" that silently
breaks COBOL ROUNDED — and the curated selection cases include an exact
half-cent fee (balance 506.00 → fee 1.265) that kills it deterministically.

The COMPOUND module is loop-shaped (compound interest over
`PERFORM ... VARYING ... UNTIL`, term 0–9 years) and proves the wave-2
loop lowering: layer C unrolls the loop so every feasible depth 0–9 is
a covered path (depths beyond the single-digit term's domain are proven
infeasible), and the year-1 accrual's half-cent boundary is solved by
witness-fixed product linearization. Its candidate B translates the
TEST BEFORE loop as an "idiomatic" do-while — the classic off-by-one
loop-count migration bug — and the curated zero-term case (which must
accrue nothing) rejects it deterministically.

The TAXCALC module proves the wave-3 PERFORM THRU range lowering:
combined payroll withholding (state + federal + local) computed by
`PERFORM CALC-STATE THRU CALC-LOCAL`, a range of three ROUNDED
paragraphs. The verifiers inline the whole range, so layer C sees all
three withholding computes on one path and solves each half-cent
rounding boundary. Its candidate B mistranslates the THRU range as a
single `PERFORM CALC-STATE`, withholding only the state portion — the
classic range-misread migration bug — and fails the curated cases on
every non-zero gross.

## Running

```
node benchmark/run-benchmark.mjs              # full pipeline, all modules (needs Docker)
node benchmark/run-benchmark.mjs --skip-images  # reuse already-built harness images
node benchmark/parse-sweep.mjs <corpus-dir>   # external parser-coverage sweep
```

Modules are listed in `modules.json` (source, harness image tag, per-layer
configs, output locations). Candidates replay from the committed cache, so
runs are offline and deterministic; layer A seeds are fixed per config.

## Findings log — what verifying against the real toolchain caught

These are real defects found by the pipeline during benchmark construction,
in the order found. They are the sales pitch:

1. **PIC 9(7)V99 store overflow (2026-07-06).** First mock-validation run
   vs real GnuCOBOL: 9/200 generated payroll cases diverged. COBOL silently
   drops integer digits beyond a PICTURE's capacity on store (no ON SIZE
   ERROR declared); the mock *and the certified Java candidate* computed
   unbounded. Fixed in both; re-validated 204/204.
2. **NUMVAL input-conversion truncation (2026-07-06).** First INTEREST
   benchmark run: 21/200 cases diverged and the module was refused
   certification. A term of "444" typed into a text field stores into
   PIC 9(2) as 44; the Java candidates kept the full value. The generator's
   small-value bias probes beyond narrow fields' storage capacity — inputs
   are text, so these are valid inputs, and the conversion boundary is a
   real defect class. Fixed across all six candidates; 3/3 modules
   certified on re-run.
3. **Benchmark runner staleness (2026-07-06).** A Docker outage mid-run
   exposed that the runner read the previous run's certificates when a step
   failed. Runner now deletes per-module artifacts before each run — a
   failed step surfaces as PIPELINE-FAILED, never as a stale verdict.
4. **Silent statement drop in the production parser (2026-07-07).** The
   first proleap sweep ranked `MergeStatement.cbl` and
   `PerformProcedureUntil.cbl` as IR-complete — impossible, since MERGE
   and PERFORM UNTIL are outside the IR subset. Cause: statements written
   before the first paragraph header sit in ProLeap's division-level
   scope, which a paragraphs-only ASG walk never visits, so they vanished
   from the IR without a trace. The sweep's own honesty tiering caught it
   (an "IR-complete" file that shouldn't be is a red flag by
   construction); the frontend now rejects stray division-level
   statements explicitly, and IR-complete dropped from 10 to an honest 5.

## Parser-coverage sweep

`parse-sweep.mjs` runs **both engines** over every `.cbl` in an external
corpus. The published run uses the ProLeap COBOL85 parser test suite —
the corpus named in the founding spec (759 files, commit pinned in
`parse-coverage.json`).

- **stub** — 0/759. The baseline that motivated the production parser:
  the bounded subset parser rejects everything in the wild, mostly on
  reference-format mechanics (column-7 indicators, continuation lines).
- **proleap front-end** — 737/759 (97.1%). The ProLeap ANTLR4 grammar +
  reference-format preprocessor (`parser/proleap/`) accepts the source.
  The ~22 rejections are the corpus's own deliberately-broken error
  fixtures (misspelled divisions, references to nonexistent copybooks) —
  files that are *supposed* to fail.
- **proleap IR-complete** — 7/759 (0.9%). The strict tier the rest of
  the pipeline consumes: every construct lowered into IR. Files in
  between parse fine but use constructs outside the IR subset; each is
  enumerated per file (never skipped silently) and histogrammed in
  `parse-coverage.json` as the prioritized lowering backlog. After
  lowering wave 1 (arithmetic verbs, period-terminated IF, level-77,
  EXIT, FILLER) the head of that histogram is control flow — GO TO and
  the PERFORM loop family — which needs the path-sensitive verifier
  engine, not just parsing. This corpus is ProLeap's own test suite and
  deliberately exercises every exotic construct, so the IR-complete rate
  is adversarially low by construction; the LEDGER module shows what the
  lowered subset covers on realistic batch code.

Both engines emit identical IR (modulo provenance) for sources inside
the stub's subset — cross-validated on all benchmark modules — so the
committed transpiler replay cache serves either engine unchanged.

## Failure modes

- Each real-binary layer A run costs ~2 minutes (docker run per case);
  the persistent-container optimization is tracked in `harness/README.md`.
- The Docker engine must be up; a dead engine surfaces as every legacy
  case ERROR-ing with exit code 1 within ~200ms (see finding 3).
- Adding a module means: COBOL source in `modules/`, three configs in
  `configs/`, recorded candidates (run migrate `--offline`, record the
  stubs), and an entry in `modules.json`.
