# External services — the non-returning boundary

A `CALL` to a vendor service (IBM Language Environment, assembler, CICS)
targets an implementation we will never see. `docs/call.md` measured that
roughly half of AWS CardDemo's call sites are of this kind and concluded
they are "permanently outside any equivalence claim".

**That conclusion was too coarse, and this document corrects it.** It
lumped together two populations that behave completely differently under
an equivalence claim:

- services whose **return value feeds later logic** (`CEEDAYS` converts a
  date into a linkage field; `COBDATFT`, `MVSWAIT`, `CBSTM03B` all return
  and the program keeps running). These really are unverifiable without
  the vendor implementation — the post-call state is unknown, so
  everything downstream is unknown.
- services that **never return** (`CEE3ABD` terminates the enclave).
  There is no post-call state to get wrong, because there is no "after".

The second population is verifiable, and it is the larger one.

## The rule

> **An external service may be modelled only if it never returns.**

Checkable, narrow, and it does not generalise into a loophole: the moment
a service returns, the unknown post-state re-enters the claim and the
module is refused exactly as before.

Under this rule the allowlist has **one** member today, `CEE3ABD`. Every
other target measured in any corpus still fails the rule and is still
rejected loudly.

## Why this is worth a stage — the corpus population

Every `CALL` target in AWS CardDemo's `app/cbl` (comment lines excluded by
indicator-column filtering, so the `CALL MENU` / `CALL CARD DETAIL`
greps in `COCRDLIC` are correctly absent):

| modules | call targets in the module | admissible under the rule? |
|---|---|---|
| **9** | `CEE3ABD` **only** | **yes** |
| 1 | `CEE3ABD` + `COBDATFT` (assembler) | no |
| 1 | `CEE3ABD` + `CBSTM03B` (stateful COBOL I/O subroutine) | no |
| 1 | `MVSWAIT` (assembler) | no |
| 1 | `CEEDAYS` (LE date service) | no |
| 2 | `CSUTLDTC` (COBOL, but calls `CEEDAYS`) | no |

The nine are `CBACT02C`, `CBACT03C`, `CBACT04C`, `CBCUS01C`, `CBEXPORT`,
`CBIMPORT`, `CBTRN01C`, `CBTRN02C`, `CBTRN03C` — the batch half of the
application. In all nine the call sits in a `9999-ABEND-PROGRAM`
paragraph reached only from an I/O error branch.

So `call.md`'s recommendation ("do not build `CALL` next — it would not
move a single real CardDemo module") holds for the *general* subprogram
call and is **wrong for the non-returning subset**, which removes the
`CALL` blocker from nine real modules. The general recommendation stands;
the blanket claim about vendor targets does not.

## Ground truth (GnuCOBOL 3.1.2, pinned container)

Predictions were written before running; all seven held. Probes:
`examples/probes/abend-*.cbl`.

| observation | measured |
|---|---|
| compiles clean; missing module is a **runtime** failure | yes — dynamic resolution of a literal `CALL` |
| stdout produced before the call | **preserved and flushed**, even to a pipe |
| statements after the call | **never execute** |
| exit status | **1** |
| stderr | `libcob: error: module 'CEE3ABD' not found` |
| `CALL 'CEE3ABD'` with no `USING` | identical behaviour |
| `CALL … ON EXCEPTION` | **catches it — the program continues, exit 0** |

The last row is load-bearing. `ON EXCEPTION` (or `NOT ON EXCEPTION`)
turns the call back into a *returning* one, so it fails the rule and must
be refused. Without that gate the model would be unsound on a shape that
compiles perfectly well.

The stdout-flush result is the other load-bearing one: if the terminating
call discarded buffered output, no output equivalence would be
attainable on the abend path at all.

## The model

`CALL 'CEE3ABD' [USING abcode, timing]` lowers to a single terminal IR
statement. It behaves, for every layer, exactly like `stop-run` except
that it terminates *abnormally*: control never continues, and the process
result is failure rather than success.

The modern side must reproduce what the certified toolchain does:
flush stdout, emit the same diagnostic on stderr, exit 1. That makes the
abend path **differentially testable against the real binary** — the
comparison is byte-identical on both streams plus the exit status, with
no appeal to a model.

## What this does and does not claim — the disclosed divergence

This is the honest part, and it belongs in the certificate rather than in
a footnote.

Under the certified toolchain, `CEE3ABD` is simply an absent module, and
the call's whole observable effect is "terminate abnormally now". On the
customer's z/OS, `CEE3ABD` is a real LE service that raises **user abend
`abcode`** (999 in CardDemo) after `timing` controls cleanup. Both
terminate the job abnormally, and in both cases nothing after the call
runs — but the abend *code* is observable on z/OS and is not observable
under the certified toolchain.

So the claim is:

- **covered** — the program reaches this call under exactly the same
  conditions in both implementations, has produced identical output
  beforehand, terminates there, and runs nothing afterwards.
- **not covered** — the abend mechanism itself, and **the argument
  values**. This is worth stating precisely, because the tempting claim
  is wrong: since the certified toolchain never runs `CEE3ABD`, the
  values moved into `ABCODE` / `TIMING` produce no observable effect, so
  no layer constrains them. Layer D confirms it — they reach no output
  field, so there is nothing to derive. A modern implementation that put
  `998` in `ABCODE` would still verify.

  On z/OS those same values *are* observable: the operator sees `U0999`.
  So the one thing the certified toolchain cannot see is the one thing
  the mainframe shows. That asymmetry is the whole content of the
  disclosure, and it is why the certificate names the service explicitly
  rather than burying it in a statement count.

Certificates therefore carry an **`externalServices`** block naming the
service, its modelled semantics, and this divergence explicitly. It is
an *environment* gap, of the same kind the signed toolchain block already
exists to communicate (`docs/dialect.md`) — not a gap in the translation.

## The instrument defect this exposed

The harness could not express any of this. `cli/src/verify/diffexec.ts`
classified **any** nonzero exit as `ERROR`:

```ts
const legacyBad = legacyRun.error !== undefined || legacyRun.exitCode !== 0;
```

That conflates two unrelated things — *the program under test terminated
abnormally, as specified* and *the harness malfunctioned*. A module whose
specified behaviour includes an abend could never pass, and, worse, the
report would blame the harness for a correct result.

This is the same class of defect as `assess` masking blockers behind a
structural rejection (stage 76): an instrument that cannot report a
legitimate outcome. Fixed here by making termination status a **compared
observable** rather than a precondition.

The fix is deliberately gated: abnormal termination is an acceptable
outcome only for a module whose IR actually contains the terminal
statement. For every other module a nonzero exit remains an `ERROR`
exactly as before, so the existing 28-module bar is unchanged by
construction.

## Enumerated residuals (rejected loudly)

- any `CALL` whose target returns — every other target in every corpus
  measured, including all of `CEEDAYS`, `MVSWAIT`, `COBDATFT`,
  `CBSTM03B`, `CSUTLDTC`, `DSNTIAR`, `CBLTDLI`, and the MQ series
- `CALL … ON EXCEPTION` / `NOT ON EXCEPTION` on an allowlisted service
  (measured above to be returning)
- dynamic `CALL <identifier>`
- a program that itself supplies a `CEE3ABD` implementation (then it is
  application code, not an environment service). **Partially closed:** the
  frontend refuses a program whose own `PROGRAM-ID` is an allowlisted
  service, but it sees one file at a time, so a codebase where a
  *different* file implements `CEE3ABD` is not yet detected. Under the
  current harness that cannot bite — each legacy image compiles exactly
  one source, so the module really is absent — but a multi-module image
  would need a corpus-level check before this model could be applied. It
  is listed here because it is unclosed, not because it is theoretical.
- `CANCEL`, `EXIT PROGRAM`, and the general stateful-subprogram model,
  which `docs/call.md` scopes and this stage does not touch

One known conservative behaviour, recorded so it is not mistaken for a
bug later: layer D's walk is a **flow-insensitive union**, so statements
written *after* a terminating call — dead code, which layers B and C
correctly drop — still contribute their output flow on the legacy side.
If such a module ever appears, layer D will report a divergence the
other layers do not. That direction is safe (it refuses to certify
rather than certifying wrongly), and no module in any corpus measured so
far puts a statement after the call, so it is left alone rather than
risking the flow-insensitive design for a shape nobody writes.

## Coverage honesty on the real modules

In all nine CardDemo modules the abend is reachable only from an I/O
error branch — a file status that is neither `00` nor `10`. The property
generator produces record streams, not broken data sets, so **layers A
and B will not reach the abend path on those modules**; only layers C and
D cover it. Where that is true the certificate must say so per path
rather than implying four-layer coverage.

The benchmark module added with this stage makes the abend reachable from
ordinary input, so the machinery itself is genuinely exercised
differentially against the real binary.

## Verified

`examples/capfee.cbl` — a fee calculation with a hard cap that refuses and
abends above 5000.00, in CardDemo's exact `9999-ABEND-PROGRAM` idiom. Both
paths are reachable from stdin, so the abend is executed rather than only
reasoned about. The modern side is hand-written to the shape `migrate`
emits, because what is under test here is the verifier, not the
transpiler.

| layer | result |
|---|---|
| A — property-based, 200 generated cases vs the real binary | **PASS 200/200** |
| B — curated differential (cases straddling the cap) | **PASS 5/5** |
| C — symbolic | **PASS**, 2/2 paths covered, 2/2 obligations verified |
| D — static data-flow | **PASS 3/3** output keys |

Layer C is the interesting one: it solved the branch boundary, derived an
input one ulp above the cap, and differentially executed the resulting
abend — the abend path is covered by construction, not by luck.

### The guards that matter more than the passes

A relaxation is only sound if it fails when it should. Four negative
tests, all confirmed:

| guard | result |
|---|---|
| modern side exits 0 where the COBOL abends | **FAIL**, `<exit status>: legacy="1" modern="0"` |
| the same module with the declaration removed | **ERROR** on the abend cases — the pre-stage bar, bit for bit |
| declaration made against an IR with no `terminate-abnormal` | **refused** by config validation |
| declaration with no IR reference to check it against | **refused** by config validation |

The second is the regression argument: nothing about a module that does
not abend changed. The third and fourth are what stop the declaration
from becoming a way to excuse a crashing module.

Note that `CAPFEE` is **not** a certified benchmark module — certifying it
needs a real `migrate` run against the model. It is a verifier fixture.
