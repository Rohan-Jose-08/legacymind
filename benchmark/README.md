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

The GRADE module proves the 88-level condition-name lowering: a
pass/fail-with-bonus routine where `88 PASSING VALUE 1` names the
pass flag and `IF PASSING` reads it (expanded to `WS-PASS-FLAG = 1`
before any verifier sees it). Layer C verifies the `score >= 60`
boundary and the bonus half-cent boundary (its congruence search is
seeded above the passing-score constraint, so it derives the odd
passing scores 61, 63, … that land the bonus on a half-cent), and
proves the impossible flag/score combinations infeasible. It discloses
one obligation it cannot symbolically realize — the derived boolean
`PASSING` flag has no input boundary to drive — which layers A and B
cover dynamically. Candidate B carries a `>` off-by-one at the pass
mark, caught by the curated score-60 case.

The TAXCALC module proves the wave-3 PERFORM THRU range lowering:
combined payroll withholding (state + federal + local) computed by
`PERFORM CALC-STATE THRU CALC-LOCAL`, a range of three ROUNDED
paragraphs. The verifiers inline the whole range, so layer C sees all
three withholding computes on one path and solves each half-cent
rounding boundary. Its candidate B mistranslates the THRU range as a
single `PERFORM CALC-STATE`, withholding only the state portion — the
classic range-misread migration bug — and fails the curated cases on
every non-zero gross.

The COMMISSION module proves the stage-1 GO TO lowering: the structured
early-exit idiom. A sales commission is 7.5% of sales ROUNDED to the
cent; if that base is over a 500.00 cap it is clamped and the paragraph
returns early via `GO TO CALC-EXIT`, paying no completion bonus —
`GO TO` the THRU endpoint of the enclosing `PERFORM CALC-COMM THRU
CALC-EXIT` range. Only this shape is admitted: the frontend rejects
every other GO TO (backward jumps, computed `DEPENDING ON`, non-exit
targets, loop-range exits), and the verifiers eliminate the sound one
into equivalent `if/else` inside `inlineStatements` before any engine
runs, so layer C enumerates the capped and bonus paths and solves both
the cap branch boundary and the base-commission rounding boundary. The
early exit is load-bearing, and candidate B is the demonstration: it
"simplifies" the GO TO into a plain clamp and then adds the bonus
unconditionally, overpaying every capped sale by 50.00 — caught by
layer B against the real binary on each capped case.

The SENIOR module proves the write side of 88-level condition names:
`SET condition-name TO TRUE`. A status flag `WS-STATUS PIC 9` carries
`88 SENIOR VALUE 1`; `SET SENIOR TO TRUE` (lowered to `MOVE 1 TO
WS-STATUS`) marks the customer senior when age >= 65, and `IF SENIOR`
(the read side from the 88-level stage, expanded to `WS-STATUS = 1`)
gates a 15% ROUNDED discount. With the flag set to a constant on each
path, layer C enumerates the senior and non-senior paths, proves the two
impossible flag/discount combinations infeasible, and verifies the age
boundary and the discount rounding, disclosing the flag-read condition
itself as unrealized (a constant on every feasible path, no input
boundary to drive, covered dynamically by layers A and B). Candidate B
reads the age threshold as a strict `> 65` instead of `>= 65`, so the
exactly-65 senior is missed; layer B catches it on the age-65 boundary.

The TIER module proves the EVALUATE lowering: a tiered order discount
selected by `EVALUATE TRUE` over three `>=` amount bands (15%/10%/5%,
WHEN OTHER none), each applied ROUNDED to the cent. EVALUATE is pure
structured sugar — the frontend expands the sound subset (single
subject, one WHEN test per phrase, `EVALUATE <subject> WHEN <value>` as
equality and `EVALUATE TRUE WHEN <condition>` as the condition, WHEN
OTHER as the innermost else) into the nested IF/ELSE chain the IR
already has, so no verifier needs EVALUATE awareness; ALSO, THRU
ranges, WHEN-value OR lists, ANY, NOT, and EVALUATE FALSE are rejected.
Layer C enumerates all four band paths and verifies every obligation —
the three band boundaries and all three per-band rounding half-cent
boundaries (the congruence search seeded above each band's threshold) —
producing a gap-free certificate. Candidate B reads the top band as a
strict `> 1000`, dropping the exactly-1000 order to the 10% band;
layer B catches it on the boundary case.

The INVOICE module proves top-level fall-through and conditional early
exit — the control-flow shape the verifier layers previously modeled
only by accident of every prior module ending its entry paragraph with
STOP RUN. INVOICE has no PERFORM at all: MAIN-PARA validates (a zero
amount prints STATUS=EMPTY and executes STOP RUN *inside the IF*),
otherwise control falls through into CALC-PARA (2.5% fee, ROUNDED) and
on into PRINT-PARA. Layers C and D now execute the whole top-level
paragraph chain and honor STOP RUN/GOBACK as a path terminator, so
layer C enumerates exactly the early-exit and billed paths — the fee's
rounding obligation exists at all only because the chain reaches
CALC-PARA — and layer D unions flows across the chain. Candidate B
drops the early return (the classic missing Java `return` when
flattening COBOL paragraph flow) and bills the empty invoice; layer B
catches it on every zero-amount case.

The SHIPPING module proves stage-2 GO TO: forward jumps across
top-level fall-through paragraphs — the guard-and-dispatch idiom. A
zero weight jumps to REJECT-PARA (skipping all costing) and an
over-cap cost jumps to CAPPED-PARA (skipping the standard print), two
different forward targets. The chain builder eliminates them
structurally: a tail-position GO TO continues the chain at its target
inside its own branch while the sibling branch carries the
fall-through continuation, with memoized shared subtrees and
strictly-forward recursion. The frontend gate admits only this shape:
the GO TO's paragraph must not be PERFORM-reachable, the target must
be strictly later, every GO TO must sit in tail position, and no
ACCEPT may textually follow a GO TO (stdin positions would become
path-dependent). Layer C enumerates and covers the
reject/capped/standard paths — the capped-path witness and the capped
half-cent obligations are realized by solving through the rounded
store (an on-grid probe of the rounding's preimage for witnesses, and
a congruence lower bound derived by inverting the rounding) — and
verifies the zero-weight boundary and the cost rounding on every path.
The cap boundary itself is honestly disclosed as unrealized: no
on-grid weight lands 4.75·w within a half-cent of 200.00, so the
boundary is proven unreachable rather than faked, and the dynamic
layers cover the cap region. Candidate B drops the zero-weight guard
and prices the empty package; layer B catches it on every zero case.

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
5. **Layer D caught a flow hidden behind a string literal (2026-07-09).**
   The first INVOICE candidate A appended the STATUS value as a bare
   string literal (`.append("READY")`), so the modern side derived the
   STATUS output from nothing while the COBOL moved the value through
   WS-STATUS. Layer D reported the key as present only on the legacy
   side and refused the module — statically, with zero execution. The
   faithful translation routes the status through a variable, mirroring
   the MOVE; re-verified 3/3 keys and certified. Layers A and B alone
   would have passed it (identical bytes on stdout): only the data-flow
   layer sees the difference between a value and its derivation.

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
  `parse-coverage.json` as the prioritized lowering backlog. Lowering
  waves have since worked down that histogram — arithmetic verbs and
  period-terminated IF (wave 1), the PERFORM loop family (wave 2),
  PERFORM THRU ranges (wave 3), 88-level condition names, and the
  stage-1 GO TO early-exit idiom. General GO TO (arbitrary forward,
  backward, and computed jumps) remains the histogram head and the next
  epic: it is unsound to lower structurally and needs the PC-based
  verifier engine, not just parsing (the committed `parse-coverage.json`
  snapshot predates these waves). This corpus is ProLeap's own test suite and
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
- Adding a module means: COBOL source in `modules/`, four configs in
  `configs/` (diff/prop/sym/static), recorded candidates (run migrate
  `--offline`, record the stubs), and an entry in `modules.json`.
