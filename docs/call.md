# CALL and LINKAGE — the subprogram boundary

Design for static `CALL` of a COBOL subprogram with `LINKAGE SECTION` /
`PROCEDURE DIVISION USING`. `CALL` affects 14 of the 20 blocked real
modules (docs/real-code-assessment.md), second only to the file cluster.

This is a design stage: the corpus is measured, the semantics are
validated against the pinned container, and the model is fixed. **No
engine code, and — unusually — the recommendation at the end is not to
build this next.** The measurement is the deliverable, because it changes
what `CALL` is worth.

## The corpus population, measured

Every `CALL` in AWS CardDemo, by target (the `CALL CARD` / `CALL MENU`
greps are comments, not code — there are **no dynamic `CALL identifier`
forms at all**, every call is a static literal):

| call sites | target | is it verifiable? |
|---|---|---|
| 13 | `CBSTM03B` | COBOL, present, **leaf** — the only real candidate |
| 11 | `CEE3ABD` | IBM Language Environment abend service — **not in the repo** |
| 4 | `CSUTLDTC` | COBOL, present, but **calls `CEEDAYS`** (IBM LE) |
| 2 | `MVSWAIT`, `COBDATFT` | **assembler** (`app/asm/*.asm`) |
| 1 | `CEEDAYS` | IBM LE date service — not in the repo |

**Roughly half the real call sites target something that is not customer
COBOL at all.** IBM LE services (`CEE*`) and assembler routines are
vendor implementations we will never see; a `CALL` to one is
structurally unverifiable for the same reason CICS is. `CSUTLDTC` looks
available but its dependency is not, so the chain breaks one level down.

All 34 `USING` clauses are plain `USING` — no `BY REFERENCE` / `BY
CONTENT` / `BY VALUE` qualifiers, so everything is BY REFERENCE (the
default).

And the one genuinely available leaf callee is awkward: `CBSTM03B` takes
a single 1KB group parameter carrying an operation code (`'O'` open,
`'R'` read, `'W'` write…) and a data buffer — it is a **file-I/O
subroutine**, i.e. it is stateful by construction (it holds open files
across calls).

## Ground truth, validated (GnuCOBOL 3.1.2, pinned container)

Probes: `examples/probes/call-main.cbl`, `call-sub.cbl`. Predictions were
written first; both held.

**Parameters are BY REFERENCE — the callee writes through to the
caller's storage.** `COMPUTE LK-OUT = LK-IN * 3` in the subprogram
changes the caller's `A-OUT` (15, 21, 27 for inputs 5, 7, 9).

**A subprogram's `WORKING-STORAGE` PERSISTS between calls.** A counter
incremented in the callee reads 1, 2, 3 across three calls from the same
caller. **This is the crux of the whole design**: a COBOL subprogram is
not a function, it is a *stateful object* whose fields are initialised
once and then survive. Any model that treats `CALL` as "substitute the
body at the call site" is unsound the moment the callee keeps state.

**`PROGRAM-ID ... IS INITIAL` restores the state-free reading**: with it,
the same counter reads 1, 1, 1 — storage is reinitialised on every
entry. This is the escape hatch that makes inlining sound, and it is
checkable in the source.

**Both linkage models agree.** `cobc -x main.cbl sub.cbl` (linked
together) and `cobc -m` (separate dynamically-loaded module) produce
identical output, so the harness may compile caller and callee together.

**A missing callee is a runtime failure**, not a silent no-op:
`libcob: error: module 'NOSUCHPG' not found`, exit 1.

## The model

A subprogram is a **stateful object**:

- its `WORKING-STORAGE` is instance state, initialised once at first
  call and persisting thereafter (unless `IS INITIAL`);
- its `LINKAGE SECTION` items are not storage at all — they are
  *aliases* onto the caller's storage, so writes are visible to the
  caller immediately;
- the natural Java shape is a class with fields for working-storage and
  a method taking the linkage group as a mutable argument.

That model is faithful, and it is what a real migration should produce.
It is also strictly more than the current IR can express: the IR models
exactly one program (stacked/nested program units are rejected today).

## The sound V1 subset — and why it is small

**C1 (inline-able subprogram).** `CALL 'literal' USING <group>` where the
callee is a COBOL source supplied to the pipeline, is a **leaf** (calls
nothing itself), performs no file I/O, and is **provably state-free per
call** — either declared `IS INITIAL`, or its working-storage is never
read before being written on any path. Then the call desugars to
inlining the callee's body with the linkage items renamed to the
caller's arguments — the O3-flat / group-REDEFINES playbook, and **every
layer works unchanged**.

**Enumerated residuals (rejected loudly):**

- a callee that keeps state between calls (the general case — needs the
  stateful-object model in the IR and in all four layers)
- a callee that performs file I/O (`CBSTM03B`, the only available real
  one)
- a callee whose source is not supplied — including **every IBM LE
  service and every assembler routine**, which is about half of real
  call sites and is permanently outside any equivalence claim
- transitive calls (a callee that itself calls)
- dynamic `CALL <identifier>` (absent from this corpus, common elsewhere)
- `BY CONTENT` / `BY VALUE`, `ON EXCEPTION` / `ON OVERFLOW`, `CANCEL`
- `PROCEDURE DIVISION USING` on the *main* program (a JCL PARM binding)

## What V1 would actually buy — the honest number

**On AWS CardDemo: approximately nothing.** Of the 13 call sites to the
one available leaf callee, all target `CBSTM03B`, which is a stateful
file-I/O subroutine and therefore excluded from C1. The other call sites
target vendor code. So C1 would not move a single real CardDemo module
closer to verifiable — it would lower a construct that real code, in
this corpus, does not use in the form we can verify.

That is worth stating plainly rather than shipping a module that
exercises a shape only our own benchmark contains. The stage would be
*sound* and would look good on the coverage table; it would not be
*useful*.

## Recommendation

**Do not build C1 next.** Two better candidates, on the same evidence:

1. **Binary `COMP` / `BINARY`** — 13 and 10 real modules respectively,
   and unlike `CALL` there is no unverifiable-target problem: it is a
   pure data-representation question with measurable semantics. It also
   closes a **known soundness gate** we opened deliberately in stage 62
   (currently rejected as "unmeasured semantics", which finding 9
   identified as a real exposure since Layer C proves against the IR's
   decimal model). Ground-truthing GnuCOBOL's binary truncation
   behaviour is exactly the kind of measurable stage this project is
   good at.
2. **The stateful-subprogram model** (the general `CALL`), if and when a
   customer codebase is available whose subprograms are *not* vendor
   services — a question the next real corpus should answer before the
   engine work is committed to.

The general lesson repeats: the count in a blocker table ("14 modules")
is an upper bound on value, not an estimate of it. Half those call sites
can never be verified by anyone, and the rest need a model this document
scopes but does not justify building yet.

## Probes

- `examples/probes/call-main.cbl` / `call-sub.cbl` — BY REFERENCE
  write-through, working-storage persistence across calls, `IS INITIAL`
  resetting it, and both compilation models agreeing.
