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
verifies every obligation including the cap boundary itself: no
on-grid weight lands 4.75·w exactly on 200.00, and the staircase
search finds the nearest achievable points on each side (42.10 →
199.98 and 42.11 → 200.02), yielding a gap-free certificate.
Candidate B drops the zero-weight guard
and prices the empty package; layer B catches it on every zero case.

The TRANSFER module proves qualified data references: two account
records whose fields share the leaf name `BAL`, referenced with
`BAL OF SRC-ACCT` / `BAL IN DST-ACCT`. The frontend renames duplicated
leaves to their hyphen-joined paths (SRC-ACCT-BAL) so the IR namespace
stays flat and unique — zero verifier changes — and resolves every
OF/IN chain against the ancestor chains at every operand site,
rejecting ambiguous bare references and unresolvable qualifications.
(The same pass closed a latent hole: qualified MOVE sources and IF
conditions previously slipped through unguarded, conflating same-named
fields in downstream refs.) A 1.25% ROUNDED fee gates a decline check
against the source balance; layer C covers both paths, verifies the
fee rounding on both, and verifies the decline boundary itself — its
decision value mixes an affine term with a rounded term over the same
variable (amount + round(amount·1.25%) − 1000), a monotone staircase
the solver searches exactly on the input grid, landing cases at
987.64 / 987.65 / 987.66. The certificate is gap-free. Candidate B is
the classic
wrong-record bug: it credits approved transfers onto the source's
1000.00 instead of the destination's 250.00 — DST_BAL off by exactly
750.00, caught by layer B on every approved case.

The RETAIL module proves nested exact rounding — the double-rounding
chain `round₂(0.0825 · round₀(0.9 · amount))`: a 10% discount settled
ROUNDED to the nearest whole dollar, then 8.25% tax ROUNDED to the
cent on the settled amount. The symbolic engine keeps the exact form
through both stores (previously a value through two rounded stores
degraded to a fuzz band), so the TIER boundary sitting directly over
the nested form (TOTAL > 500) is verified by the exact staircase
search, and the dollar settle's half-unit boundary is congruence-
solved. The outer tax half-boundary needs congruence over a rounded
value (solve the settled-dollar congruence, then invert the inner
rounding) — disclosed as unrealized and tracked as the next solver
depth, covered dynamically. Candidate B "streamlines" the double
rounding into one, taxing the unrounded discounted amount: whenever
the dollar settle moves the base (10.56 → 9.504 settles to 10), the
tax differs by whole cents (0.78 vs the correct 0.83) — caught by
layer B on the curated settle cases.

The PAYSLIP module opens the file I/O family (stage 1: one LINE
SEQUENTIAL output file — SELECT/ASSIGN, FD, OPEN OUTPUT, WRITE, CLOSE).
The pay slip's three KEY=VALUE records go to `slip.dat`; the module's
harness image (`Dockerfile.file`) wraps the program so each run
serializes the output file to stdout after the program's own DISPLAY
lines, making the file part of the single observable KV stream — the
differential layers compare file contents on every case with no
verifier changes (OPEN/WRITE/CLOSE are flow-neutral for the symbolic
store; the record's MOVEs are ordinary modeled storage). The FD record
lowers into the data division; the frontend rejects everything beyond
the stage-1 subset (OPEN INPUT/I-O/EXTEND, READ, WRITE FROM/ADVANCING,
non-LINE-SEQUENTIAL organizations, multiple record layouts). Layer D
covers the program's stdout keys; the file records are dynamic-layer
territory at this stage, disclosed in the config. Candidate B loses the
slip's last record — the classic unflushed-buffer migration bug — and
is caught on every case (NET missing, ROWS diverging).

The BONUS module proves PROCEDURE DIVISION sections. Sections flatten
onto the paragraph model: each section header becomes a synthetic
paragraph holding the section's own statements (the ones before its
first paragraph header), followed by its paragraphs, and
`PERFORM <section>` lowers to `PERFORM <section> THRU <its last
paragraph>` — the existing THRU machinery inlines the whole thing, so
no verifier needs section awareness. BONUS's CALC SECTION carries three
blocks (3% base ROUNDED, a 150% ROUNDED uplift over 50000.00 — a
nested rounding over the settled base — and the total); layer C
enumerates both paths, verifies the uplift boundary at ±1ulp and the
base's half-cent congruence, and discloses the nested uplift's
half-boundary as the already-tracked congruence-over-a-rounded-value
solver depth. Candidate B is the classic section-vs-paragraph bug:
`PERFORM CALC` translated as the section's first block only, skipping
the uplift and total — caught by layer B on every non-zero case.

The BATCHSUM module is the record protocol's first outing (file I/O
stage 2a, docs/record-protocol.md): the true batch archetype — READ a
LINE SEQUENTIAL input file to end-of-file, accumulate, report. The
case's stdin lines ARE the input file's records (the
`Dockerfile.infile` wrapper), so every layer's cases carry
variable-length record streams: layer A's generator draws a per-case
record count biased toward the empty file, one record, and the
maximum, and shrinks failures by dropping records; layer C renders the
record count through the loop unroller — record slot k is an ordinary
input variable, the NOT AT END arm binds it, the AT END arm fixes the
case at k records — so paths cover files of exactly 0..max records,
each realized as a case with that many lines (the empty file
included), with the beyond-bound region disclosed as unknown coverage.
Building it caught and fixed three latent issues: a zero-line case
previously piped a bare newline (one blank record — the legacy side
counted 1); WORKING-STORAGE VALUE initializers were never seeded into
the symbolic state (an EOF flag relying on VALUE ZERO was opaque at
its first test); and the modern-side extractor now reads assignments
inside loop conditions, the canonical Java stream-read idiom.
Candidate B discards a priming read as if it were a header — every
non-empty file loses its first record from COUNT and TOTAL; the empty
file agrees by accident, which is exactly why it is a mandatory but
insufficient case.

The REBATE module is the first multi-field fixed-width record (file I/O
stage 2b, docs/memory-layout.md): each input line packs a numeric
customer id, a purchase amount with an implied `V99` decimal, and
trailing padding into a fixed 13-byte record, decoded by byte offset. A
2% rebate (ROUNDED) is paid on purchases of 100.00 or more. The
frontend computes the record's byte layout (each field's offset, width,
and decode kind from its PICTURE) and layer C recomputes it from the
data-division tree and asserts the two agree before executing — drift
between the frontend and the verifier is a build error, never silent.
Record k binds each non-filler field to its own input variable (k*F+j),
so the 100.00 threshold branch and the 2% rounding half-boundary are
both proven per record; deep multi-record branchy paths are disclosed
and covered dynamically by layers A and B. The verified envelope is
well-formed records only — GnuCOBOL itself has no coherent semantics
for a numeric field that a short line cuts mid-way (its DISPLAY and its
arithmetic decode the same bytes differently), so the certificate
refuses to claim what the reference cannot define. Candidate B carries
the canonical fixed-width defect: it miscounts the id field and decodes
the amount one byte early, so every record parses cleanly to a wrong
value (and below-threshold records wrongly qualify) — caught by layer B
on every non-empty case. Building it extended the modern-side extractor
to follow `substring` (a field derives from its record line) and taught
both sides that a numeric field's implied `V` decimal is a real decimal
shift of the raw input bytes, so the flows match without a hack.

The DUES module is the first REDEFINES program (stage R1a,
docs/redefines.md): the legacy record stores a dues amount as a whole
number of cents, and `WS-DOLLARS REDEFINES` that field reinterprets the
same six digits as dollars-and-cents for the money math. REDEFINES is
byte aliasing, and layer C's store is keyed by name, so it needs its own
stage — but the read-only, equal-width, numeric-over-numeric subset
reduces to a pure decimal shift (`value(view) = value(target) ·
10^(target.scale − view.scale)`), the operation layers C and D already
model. The frontend gate admits exactly that shape and rejects the rest
with a specific reason (a written view, a width mismatch, a non-numeric
view). Because the reinterpreted view is affine in the input, layer C is
gap-free: it verifies both the 100.00 tier boundary and the 5% fee
rounding half-cent directly (the congruence lands the fee on a half-cent
at every cents value ≡ 10 mod 20). Candidate B carries the wrong-scale
reinterpretation — the archetypal REDEFINES defect, reading the view at
its target's scale so every amount comes out 100x too large — caught by
layer B on every non-zero case and by layer D as a missing decimal
shift. The same layout vocabulary now underwrites records (2b),
REDEFINES, and, next, OCCURS.

The TABSUM module is the first OCCURS program (stages O1/O2,
docs/occurs.md): a fixed table (W-VAL OCCURS 4 TIMES) is filled from
input and summed through a PERFORM VARYING loop over W-VAL(I), with a 2%
fee ROUNDED on the total. OCCURS gives one name to N cells and the
subscript chooses the cell at reference time, but the engine already has
the tool that tames it — the loop unroller drives the canonical idiom to
iterations each with a constant subscript, at which W-VAL(I) names one
definite cell. So the fixed-table, constant-subscript subset adds no new
solver surface: layer C resolves each cell, W-TOTAL is the affine sum of
the four inputs, and the fee rounding half-cent is verified directly. The
frontend admits subscripted references to a declared table (and strips
the subscript variable out of value data-flow, since an index is not an
operand) and rejects OCCURS DEPENDING ON, INDEXED BY, sort keys, and
group elements with a specific reason. Layer D unions the table's cells
into one logical region — symmetric with a Java sum over an array.
Candidate B carries the archetypal table defect, the off-by-one bound
that drops the last cell (as if the loop ran while I < 4 rather than
until I > 4); any table with a non-zero final element catches it. The
byte-layout vocabulary now underwrites all three data-shape corpus heads
— records, REDEFINES, and OCCURS — from one model. (Building it also
surfaced a real ground-truth trap: ACCEPT of a decimal value directly
into a numeric field truncates to the field's digit width, so the table
is filled through FUNCTION NUMVAL, which parses the full value — a
reminder that the reference tool, not the intuition, defines behavior.)

The SETTLE module rounds out OCCURS access: the ledger table is filled by
a subscripted MOVE from NUMVAL, and the settlements are summed through a
strided affine subscript W-ITEM(2*I) (the frontend now admits affine
subscripts in arithmetic and MOVE targets). It also closes a real layer-D
gap. A strided subscript touches only some cells, so the natural scalar
translation would derive its result from a subset of the inputs while the
legacy side unions the whole table — a spurious DIVERGENT. The fix is
symmetry: the modern extractor now treats a Java array as one flow region
(every element writes union in, every read pulls the whole region), so a
faithful array-and-loop translation flows exactly like the COBOL table.
Both sides over-approximate identically; a wrong stride is a value/index
bug that layers B and C catch (candidate B here sums the accruals instead
of the settlements — the classic table-stride error — caught by layer B
on any ledger whose two columns differ). Layer C still verifies the fee
rounding half-cent directly. The byte-layout vocabulary now spans records
(2b), REDEFINES, and OCCURS — and OCCURS reads, writes, and strides.

The LOCKER module is the group-REDEFINES program (stage RG,
docs/redefines-edited.md): the member record stores raw digits — a
4-digit id and the balance as a whole number of cents — and WS-MONEY
REDEFINES the record group leaf for leaf, reinterpreting the balance
digits as dollars-and-cents for the 2.5% late-fee math and the 200.00
GOLD tier. The sound subset is one-to-one leaf alignment: each view leaf
pairs with the target leaf at the same offset and byte width, so a group
view is REDEFINES R1a applied per aligned leaf — the frontend validates
the alignment (equal leaf counts, pairwise-equal digit counts, read-only
view, no group-as-whole references, no OCCURS) and emits the ordinary
per-item redefines mapping on each view leaf, and the verifier needed
**zero changes**: layer C resolves each view-leaf read as the aligned
target's value at the shifted scale (the fee half-cent ties land at
cents ≡ 20 mod 40, realized on both tier paths), and layer D derives
each view leaf from its aligned target's flow. Candidate B carries the
wrong-leaf re-slice — the money view read from the id leaf's bytes, the
archetypal group-overlay offset confusion — caught twice: layer B on
values (a zero balance with a nonzero id yields a phantom fee) and layer
D structurally (FEE/TOTAL derive from input 0 where the legacy flows
read input 1). Misaligned widths, written view leaves, and
group-as-whole references are each rejected loudly with the specific
reason, validated by probe.

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
6. **The reference implementation has no defined answer (2026-07-11).**
   Ground-truthing the first multi-field record (REBATE) against real
   GnuCOBOL surfaced a case with no correct certificate to issue: when a
   short input line cuts a numeric field mid-way, GnuCOBOL's DISPLAY of
   that field and its arithmetic on it decode the same bytes to
   *different* values, and no runtime error fires (exit 0). Rather than
   pick one interpretation and certify a fiction, the stage-2b envelope
   excludes malformed records explicitly — the strongest form of "prefer
   refusing over mis-answering" in the product so far: the verifier
   declines to certify behavior the reference itself does not define.
   The same construction fixed a real false negative in layer D — a
   numeric field's implied `V` decimal is a decimal shift of the raw
   input bytes, so modeling it on the legacy side (symmetric with the
   Java candidate's explicit scaling) turned a spurious DIVERGENT into a
   verified match without weakening the check.

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
- **proleap IR-complete** — 15/759 (2.0%). The strict tier the rest of
  the pipeline consumes: every construct lowered into IR. Files in
  between parse fine but use constructs outside the IR subset; each is
  enumerated per file (never skipped silently) and histogrammed in
  `parse-coverage.json` as the prioritized lowering backlog. Lowering
  waves have worked down that histogram — arithmetic verbs and
  period-terminated IF, the PERFORM loop family, PERFORM THRU ranges,
  88-level condition names both ways (IF condition-name, SET ... TO
  TRUE), EVALUATE, forward GO TO (range early-exit and guard-and-
  dispatch), qualified OF/IN references, PROCEDURE-DIVISION sections,
  a LINE SEQUENTIAL file (output stage 1, then the READ/record protocol
  for input), and the byte-layout family — multi-field fixed-width
  records, REDEFINES, and OCCURS all from one model. The REDEFINES head
  is now sub-classified by the shape of the redefining view: 3,218
  numeric-edited views, 961 group views, 52 signed-numeric, 42
  alphanumeric (the R1a elementary-numeric slice is lowered; these are
  the remainder). But measuring that head honestly surfaced a caveat that
  matters more than the split: **~93% of it is one test artifact.**
  Counting REDEFINES *lines*, 3,856 of 4,450 redefine the NIST **CCVS**
  (COBOL Compiler Validation System) self-checking scaffold —
  `COMPUTED-A` / `CORRECT-A`, a 20-byte answer field redefined by ~10
  edited/group views — a single boilerplate block repeated across 459
  NIST files. The corpus's top backlog line is inflated ~14x by
  compiler-conformance test code, not 4,000+ business idioms; the genuine
  tail is a few hundred lines. That measurement (and its consequence — do
  not build an edit-picture engine to chase a test count) is written up in
  `docs/redefines-edited.md`. OCCURS similarly split into the
  fixed-numeric-table subset (lowered) versus 381 group/non-numeric-element
  tables (O3). Past the scaffold-inflated REDEFINES head, the real
  histogram is qualified/subscripted MOVE (3,160), the
  file-I/O statement family (OPEN/CLOSE/WRITE-with-clauses/READ outside
  the supported files), SET to a non-condition target (825), and the
  remaining GO TO shapes (backward and PERFORM-reachable jumps). This
  corpus is ProLeap's own test suite and deliberately exercises every
  exotic construct, so the IR-complete rate is adversarially low by
  construction; the LEDGER module shows what the lowered subset covers
  on realistic batch code.

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
