# Layer C declines, and why a decline is written down

*Stage 89, 2026-08-05.*

Layer C (symbolic execution) reasons soundly about a bounded subset of COBOL
shapes. Outside that subset it refuses. Refusing is correct — the alternative
is a confident wrong claim — but until this stage the refusal existed only as
a message on a terminal, and that made the certificate lie by omission.

## The defect

`verify --layer C` threw and wrote no report. `certify` therefore saw an
absent `--layer-c` and emitted:

```
"C": { "status": "NOT_RUN", "note": "symbolic-execution report not provided" }
```

That text is identical for two very different situations:

| situation | what the reader should conclude |
|---|---|
| nobody ran layer C | run it; evidence may exist |
| layer C was run and refused the module | no symbolic evidence exists, and none can be produced by this engine |

The second is a *fact about the customer's program*, and it is one of the more
valuable things a report can say. Collapsing it into the first understates
what is known — the same failure class as a hollow pass, pointed the other
way. A certificate that hides a known limit is not a certificate.

## The fix

A refusal caused by the **program's shape** now throws `SymbolicDeclined`
(`cli/src/verify/symexec.ts`). `cmdVerify` catches it, writes a DECLINED
report artifact, and still exits 2 — a decline is not a pass, and nothing
that gates on exit status moves.

```json
{
  "tool": "legacymind verify --layer C",
  "verdict": "DECLINED",
  "reason": "layer C: READ after AT END on the same path (outside the stage-2a shape)",
  "config": "cbcus01c-sym.json",
  "ir": "CBCUS01C.ir.json"
}
```

`certify --layer-c <that file>` records `status: "DECLINED"` and lifts the
reason verbatim into the signed gaps. The decline supplies no evidence, so it
is filtered out of the "at least one supporting layer" test exactly like
`NOT_RUN`: **a declined layer can never be what certifies a module**, and no
verdict changes as a result of this stage.

The report artifact deliberately carries no summary, no obligations and no
path counts. A decline establishes nothing about the module except that this
engine will not reason about it, and a report shaped like a passing one would
invite the opposite reading.

## What is classified as a decline, and what is not

Only refusals that describe the **program**. 19 sites, in 18 classes:

- `PERFORM` cycles (needs fixpoint machinery), and `PERFORM ... THRU` ranges
  that are not valid forward ranges
- the five unsupported `GO TO` shapes (non-forward, non-tail, both-branches,
  nested below an IF tail either side), and `GO TO` surviving structured
  elimination
- `ACCEPT` inside a `PERFORM` body, `ACCEPT` alongside an input file, and
  `ACCEPT` into an unresolvable table cell
- path explosion, in all four places it is detected
- `READ after AT END on the same path`
- an unsupported statement kind

Deliberately **not** declines, and still hard errors with no artifact:

- bad or missing symbolic config (no `symbolic` block, `baseCase` the wrong
  length, `records.domain` missing, a field name that is not in the data
  division)
- internal invariant violations: rational division by zero, record-layout
  drift between the frontend and the verifier, a missing input value

The reason for that boundary is the same discipline the rest of the project
runs on: a certificate must never state "layer C declines this module" on the
strength of a typo in a config file. An unclassified refusal degrades to the
old behaviour — `NOT_RUN`, "not provided" — which is weaker but not false.

## Measured: why layer C declines the three CardDemo modules

Run against `CBACT02C`, `CBACT03C` and `CBCUS01C` (untouched AWS CardDemo),
all three decline **identically**:

```
layer C: READ after AT END on the same path (outside the stage-2a shape)
```

and at the default 64-path bound they decline earlier still, with
`more than 64 paths; needs bounded exploration`.

The chain is: the read loop's exit is driven by a **FILE STATUS** value
(`CARDFILE-STATUS = '00'`), which this engine does not model. So the
end-of-file flag is opaque, so `UNTIL END-OF-FILE = 'Y'` cannot be decided,
so the unroller explores an iteration past `AT END` and hits the guard.

**This corrects a claim that was in `HANDOFF.md`**, which attributed the
decline to byte-modelled storage. That is wrong, and measurably so: stage 80
changed byte-modelled items to start *opaque* rather than refusing the module
(`byteModelledNames`, and the comment at the head of `runSymExec`). Opaque
items fork honestly and claim nothing; they do not trigger a refusal. The
byte-window disclosure in the certificate is a separate and still-correct
statement — it is about what layer C *cannot conclude*, not about why it
declined to start.

Lifting this decline is a real engine stage — modelling FILE STATUS as a
first-class symbolic value with the `'00'`/`'10'` domain — not a config
change. It is not attempted here.
