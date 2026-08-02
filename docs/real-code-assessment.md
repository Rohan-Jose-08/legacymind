# Real-code assessment — what `assess` says about code we did not write

> **Corrected 2026-08-02.** The first version of this document reported
> blocker counts that were **too low**: a structural rejection
> ("PROCEDURE DIVISION has no paragraphs", "statement before the first
> paragraph header") stopped the frontend before it lowered the affected
> statements, so every construct underneath was silently omitted from the
> module's blocker list. An assessment that under-reports blockers is
> exactly the hidden failure this product exists to refuse, so the
> frontend now enumerates those statements for analysis while keeping the
> module blocked. Numbers below are the corrected ones; the deltas are
> called out where they matter. Nothing about the verdicts changed —
> VERIFIABLE stayed 15/759 on NIST and 0/31 on CardDemo.

Every coverage number this project has published came from either its own
benchmark (27 modules we wrote) or the ProLeap/NIST test corpus (parser
fixtures). Neither is customer code. This is the first measurement
against **real, third-party COBOL**, run 2026-08-01.

The headline is not flattering, and that is the point of running it.

## Corpora

| corpus | what it is | files |
|---|---|---|
| `aws-samples/aws-mainframe-modernization-carddemo` @ `59cc6c2` | a real mainframe credit-card application (CICS + VSAM + BMS + batch JCL), built by AWS to represent a genuine z/OS workload | 31 COBOL, 62 copybooks |
| `navikt/DSF` @ `faade49` | Norway's *Det Sentrale Folketrygdsystemet* — a real production national-insurance system | 7 COBOL (**1,473 PL/I**) |
| `openmainframeproject/cobol-programming-course` @ `61c573d` | Open Mainframe Project teaching material | 7 COBOL |
| `uwol/proleap-cobol-parser` (NIST CCVS + fixtures) | parser conformance corpus — the historical baseline | 759 |

Analysis is **parse-only**: third-party source is never compiled or
executed.

## Result

| corpus | files | VERIFIABLE | BLOCKED | PARSE-FAILED |
|---|---|---|---|---|
| AWS CardDemo (real mainframe) | 31 | **0 (0.0%)** | 14 | 17 |
| DSF + OMP course | 14 | **0 (0.0%)** | 6 | 8 |
| NIST/ProLeap (baseline) | 759 | 15 (2.0%) | 722 | 22 |

**Zero of 45 real-world programs are verifiable today.** That is the
number every go-to-market decision has to start from.

### How far away is "blocked"?

Distinct blocking constructs per blocked module — a module needs *all* of
them supported before it can be certified, so this is a product of
independent gaps, not a sum:

| corpus | median | range | ≤3 blockers |
|---|---|---|---|
| AWS CardDemo | **26** | 4–33 | 0 of 14 |
| DSF + OMP | 12 | 1–18 | 2 of 6 |
| NIST/ProLeap | 11 | 1–73 | ~290 of 722 |

(CardDemo before the masking fix read "2–32, 1 of 14". Ten of its
fourteen blocked modules were under-reporting; the nearest module moved
from 2 blockers to 4, and **no** real module is within 3.)

Real mainframe modules sit ~26 constructs away from verifiable. This is
the central finding: the gap to real code is not one feature, it is a
long tail where every item is mandatory per module.

### The CICS wall is worse than "blocked" suggests

17 of CardDemo's 31 programs **never reach the blocker analysis** — they
fail to parse because they `COPY` IBM CICS system copybooks (`DFHAID`
×12, `DFHBMSCA` ×5) that ship with CICS, not with the application. So
`EXEC CICS` barely appears in the blocker table below: those modules died
earlier. 25 of 44 CardDemo COBOL files contain `EXEC CICS`.

Practical consequence: assessing a customer codebase requires their
**vendor copybook libraries**, not just their source. Expect to ask for
them, and expect the first assessment to fail without them.

## What real code actually needs (demand-ranked)

Modules affected, across CardDemo + DSF/OMP only (real code, not
fixtures):

| modules | blocker |
|---|---|
| 15 | `CLOSE` of a file outside the lowered subset (VSAM/indexed) |
| 14 | `CALL` statement (inter-program calls) |
| 14 | `OPEN` of a file outside the lowered subset |
| 13 | procedure name not representable in the IR |
| 13 | `USAGE COMP` (binary — outside the verified subset) |
| 11 | `REDEFINES` group view over an elementary target |
| 11 | COPY/REPLACE expansion broke span provenance |
| 11 | statement before the first paragraph header |
| 10 | `PERFORM` target is not a paragraph in this program |
| 10 | `READ ... INTO` |
| 10 | `USAGE BINARY` |
| 9 | `CONTINUE` |
| 9 | reference modification (`X(1:4)`) |
| 6 | `INITIALIZE`, inline `PERFORM` |
| 5 | `LINKAGE SECTION` |

Read as themes, real code needs, in order:

1. **VSAM / indexed files** — `SELECT ... ORGANIZATION INDEXED`,
   `READ INTO`, non-literal `ASSIGN TO`. The file model only covers LINE
   SEQUENTIAL. This is the single biggest cluster.
2. **Inter-program `CALL`** and `LINKAGE SECTION` — real systems are many
   small programs, not one. Nothing in the pipeline models a call
   boundary today.
3. **Binary `COMP`** — 35 of 44 CardDemo files declare it. Rejected at
   declaration since stage 62 (correctly — it is unmeasured), but it
   gates most real modules.
4. **The ordinary-verb tail** — `CONTINUE`, `INITIALIZE`, `STRING`,
   inline `PERFORM`, reference modification. Individually trivial,
   collectively a wall.
5. **CICS/BMS** (and DB2) — structurally excluded, and it is *most* of
   the online half of a real estate.

## The nearest real module is not near

`COBSWAIT.cbl` looked like the closest thing to a first real certified
module — 2 blockers. It is not a candidate at all:

- the "2" was masking two more (`ACCEPT ... FROM`, `CALL`), so it is
  really 4;
- and its whole purpose is `CALL 'MVSWAIT' USING ...` — an external
  **assembler** wait routine. There is no COBOL behaviour to establish
  equivalence *for*; the program's entire observable effect happens
  inside a module we would never see.

The next nearest, `CSUTLDTC.cbl` (12 blockers), needs `CALL` +
`LINKAGE SECTION` + `PROCEDURE DIVISION USING` + `OCCURS DEPENDING ON` +
binary `COMP` + two REDEFINES shapes. So the honest statement is: **no
single stage, and no plausible pair of stages, produces a certified
third-party module.** That is a multi-stage programme, and the roadmap
should say so rather than implying the next feature unlocks real code.

## Three product defects this surfaced

1. **Quoted `COPY 'NAME'` does not resolve `NAME.cpy`.** ProLeap's
   literal copybook finder requires an exact filename match and ignores
   `copyBookExtensions` (verified: setting extensions, and setting
   `copyBookFiles` explicitly, both fail; only an extensionless file
   resolves). Real code writes `COPY 'CSUTLDWY'` against a `CSUTLDWY.cpy`
   file constantly. Until fixed, `--copybooks` silently under-resolves on
   most real codebases and inflates PARSE-FAILED. Workaround used for
   this measurement: stage extensionless copies (collision-checked).
2. **COPY span provenance still fails on real code** — 11 real modules
   report "preprocessor changed the line structure … span provenance
   cannot be mapped", the honest reject added in stage 61. The
   sequence-alignment fallback handles the benchmark's simple COPY sites
   but not real-world expansion (`REPLACING`, adjacent COPYs, nested).

3. **Structural rejections masked every blocker beneath them** (fixed
   2026-08-02, see the note at the top). "PROCEDURE DIVISION has no
   paragraphs" and "statement before the first paragraph header" stopped
   the frontend before those statements were lowered, so their
   constructs never reached the report. Effect: 10 of CardDemo's 14
   blocked modules and 96 NIST modules under-reported their distance,
   and 73 NIST modules looked unlockable by the paragraph fix alone when
   they were not. Unlike defects 1 and 2, this one was not loud — the
   report was confidently incomplete, which is worse than a refusal.

Defects 1 and 2 are honest failures (loud, enumerated, never silent) —
but all three make the tool weaker on real code than the NIST numbers
implied.

## The scaffold lesson, a sixth time

119 NIST modules are blocked *only* by paragraph-structure constructs, so
"support statements outside paragraphs" looks like it would take the NIST
rate from 2.0% to ~18%. Inspecting them kills that headline:

- **48** have no `PROCEDURE DIVISION` at all — nothing to verify.
- **4** have an empty one.
- **67** have statements, but are ProLeap *unit-test fixtures*
  (`AddToStatement.cbl`, `DisplayStatement.cbl` — 5-line, single-verb
  programs).

(Before the masking fix this read 192 / 140, and the tempting headline
was "2% → 27%". Complete enumeration showed 73 of those 192 were hiding
*other* blockers behind the structural one — so even the corrected 119 is
an upper bound on what the paragraph fix alone would unlock.)

On real code the same fix unlocks **2 of 45** files (`DEPTPAY.CBL`,
`EMPPAY.CBL` — both from a *testing* course), and **0** of CardDemo.
Publishing "2% → 27%" would have been a true statistic and a false claim.
The corpus cannot rank the backlog; only real code can.

## What this means

- **Do not market on coverage.** The honest statement to a prospect is:
  "today we verify a well-defined subset of batch COBOL; on a real
  mainframe application we currently verify none of it end-to-end, and
  here is exactly what stands in the way." The `assess` report is the
  product being demonstrated — it tells the truth before any money moves.
- **The roadmap should follow this table, not the corpus histogram.**
  VSAM + `CALL` + binary `COMP` + the verb tail is the path to a first
  real certified module. That is a multi-stage programme, not a sprint.
- **The differentiator is unaffected.** Nothing here questions the
  four-layer verifier or the certificates; the machinery works and is
  proven on 27 modules. What is unproven is *reach* — how much of a real
  codebase it can be pointed at.

## Reproducing

```
git clone --depth 1 https://github.com/aws-samples/aws-mainframe-modernization-carddemo
node cli/dist/main.js assess <repo>/app/cbl --out <out> --copybooks <staged-copybooks>
```

Copybooks must currently be staged extensionless (defect 1 above).
