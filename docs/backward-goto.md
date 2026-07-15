# Backward GO TO — two constructs, one 86%-scaffold head

Design stage for the last control-flow rejection head: backward and self
GO TO jumps. The headline, as with the REDEFINES and subscripted-MOVE
heads before it, is a measurement — the head is dominated by NIST
conformance-test plumbing, and it is not one construct but two. Every
claim below is validated against real artifacts: the corpus population by
direct measurement of the pinned checkout, the desugar semantics by
GnuCOBOL 3.1.2 (`examples/probes/goto-loop.cbl`), and the frontend model
by reading `gateGotos`.

## The head, measured

The GO TO rejection family in `parse-coverage.json` totals **2,616**:

| bucket | count | distinct messages |
| --- | ---: | ---: |
| backward or self jump | 1,130 | 349 |
| GO TO inside a PERFORM-reachable paragraph | 1,436 | 151 |
| GO TO ... DEPENDING ON | 29 | — |
| target not representable in the IR | 258 | — |

Classifying the jump targets by name shape, **2,248 (86%) are the NIST
CCVS harness paragraphs** — `FAIL-ROUTINE`, `BAIL-OUT`, `CLOSE-FILES`,
and the `*-WRITE` file-write plumbing that every conformance file
declares. The non-CCVS remainder is **318**, and it is itself dominated
by NIST *file-status test* error handlers (`READ-SHORT-REC-ERROR`,
`READ-LONG-REC-ERROR`, `*-EXIT`) and GO-TO/ALTER *feature-test* names
(`BUILD-LEVEL-1/2/3`, `PARAGRAPH-NAME-5/11`, `ALTERABLE-PARAGRAPH`). The
genuine *business* backward-GO-TO idiom is close to absent.

## Two different constructs hide in this head

A "backward or self jump" rejection covers two semantically distinct
shapes that need entirely different handling:

- **Loops** — the pre-`PERFORM VARYING` idiom: enter a paragraph range at
  the top, `IF <exit-cond> GO TO <after>`, do work, `GO TO <top>`. The
  genuine instance in the corpus (`BUILD-LEVEL-1/2/3` in NC136A, a
  triple-nested table fill) is exactly this. It is a **structured loop
  wearing labels**.
- **Bail-outs** — `GO TO CLOSE-FILES` / `GO TO FAIL-ROUTINE`: jump to a
  designated cleanup or error paragraph. The CCVS 2,248 are these. They
  are not loops at all; they are structured early-exits to a terminal
  handler, and ProLeap rejects them only because they violate its narrow
  forward-only top-level model.

Conflating them is the trap: the loop-fixpoint machinery a true backward
loop seems to demand is not what 86% of the head actually needs.

## Validated ground truth (GnuCOBOL 3.1.2)

A reducible single-back-edge loop is behaviourally identical to the
`PERFORM UNTIL` that structures the same range —
`examples/probes/goto-loop.cbl` sums 1..10 both ways and both print
`0055`. So the loop construct has a **sound, proof-grade desugar** that
reuses machinery already in the engine, rather than a new executor.

## The frontend today

GO TO is lowered faithfully to a `go-to` node; `gateGotos` decides
soundness once every paragraph and PERFORM range is known. It admits two
shapes: **stage 1** — early-exit of an enclosing `PERFORM THRU` range
(forward, to the range's own exit paragraph); **stage 2** — a strictly
forward jump across top-level fall-through paragraphs. A backward or self
jump (`tIdx <= pIdx`), and a GO TO out of a PERFORM-reachable paragraph
that is not a structured range exit, are rejected. There is no loop or
cycle notion anywhere in the model — the whole engine is a path unroller
over a DAG of paragraphs.

## The buildable sound subset — GO-3, the reducible single-back-edge loop

The one proof-grade, cleanly-completable slice is the loop construct,
desugared to the existing `PERFORM UNTIL`:

- **Shape**: a contiguous paragraph range `[H .. B]` where `H` is reached
  only by fall-through or PERFORM; the sole back-edge is a `GO TO H` that
  is the last statement reachable in `B`; a single conditional
  `IF <cond> GO TO <X>` (with `X` the first paragraph after `B`) is the
  loop exit; no edge enters the body except at `H`, and no other GO TO
  crosses the range boundary.
- **Desugar**: rewrite to `PERFORM H THRU B' UNTIL <cond>`, where `B'` is
  `B` minus its trailing `GO TO H` and the guard `IF <cond> GO TO X`
  becomes the `UNTIL`. From that point the entire PERFORM UNTIL pipeline
  applies unchanged — the Layer C unroller forks the loop, Layer D unions
  the body — so the **verifier needs zero changes**, the same leverage
  RG, O2x, and O3-flat each got from reusing an existing model.
- **Rejection**: every non-reducible shape — multiple back-edges, a jump
  into the body, a self-loop with no forward exit, `ALTER`, computed
  `GO TO ... DEPENDING ON` — is rejected loudly with its specific reason.

The regression bar is absolute: no existing benchmark module uses
backward GO TO, so all 25 must stay byte-identical, and GO-3 can only add
a new PERFORM-shaped module.

## Recommendation

GO-3 is ready to build and is honest, proof-grade capability for real
pre-`PERFORM` legacy code (a genuine class in banking/insurance systems
that predate 1985). But three facts argue against building it *next*:

1. **The corpus demand is thin and 86% scaffold.** The count that would
   motivate it is CCVS conformance plumbing, and the plumbing is
   bail-outs, not loops — a different construct GO-3 does not address.
2. **The genuine loop instances are mostly NIST GO-TO feature tests**
   (testing the statement, not using it), so even the non-scaffold tail
   over-represents real demand.
3. **`PERFORM VARYING`/`UNTIL` — which GO-3 desugars to — is already
   lowered**, so GO-3 adds a translation surface, not a new verified
   behaviour class.

So: **backward GO TO is designed-and-deferred.** Build GO-3 when a design
partner's real code presents backward-GO-TO loops (it is a small,
self-contained frontend stage at that point); do not build the
loop-fixpoint/PC executor for the bail-out majority, which is harness
plumbing. Higher-value next capability lives elsewhere — `INDEXED BY`
tables (98, a real business idiom), the solver's loop-condition
disclosure class, or a design partner's actual code.

## Named residuals (disclosed, not approximated)

- **Bail-out GO TO** (the CCVS majority): a structured early-exit-to-
  handler model, overlapping the existing forward-GO-TO stages; deferred.
- **Irreducible control flow** (multiple back-edges, jumps into a loop
  body, `ALTER`, `GO TO DEPENDING ON`): genuinely needs a fixpoint or
  program-counter executor — the single largest engine investment left,
  deliberately not built for a scaffold count.
