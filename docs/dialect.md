# The dialect is part of the claim

A certificate says "this Java behaves like this COBOL". That sentence is
incomplete: COBOL's meaning is fixed by a *compiler with options*, and
stage 69 (docs/binary-comp.md) found the first construct whose semantics
change with a compiler flag rather than with the source. This stage asks
how far that problem reaches, and closes the gap it exposed in the
sellable artifact.

## Does an existing certificate transfer to another dialect?

The experiment: take every benchmark module whose observable is
stdin-only (22 of the 28), compile each one **from the same source**
under three option sets in the pinned container, run each build against
that module's own certified cases, and diff the outputs.

| option set | modules whose output differs | fail to compile |
|---|---|---|
| `-fno-binary-truncate` | **0 of 22** | 0 |
| `-std=ibm` | **0 of 22** | 0 |

**Every certified module is dialect-invariant across all three.** That is
a real, and reassuring, result: the verified subset as it stood was
dialect-*neutral*, so the 28 certificates do not silently depend on our
choice of compiler options.

The reason is precise rather than lucky — none of those modules uses
binary `COMP`. Dialect sensitivity entered the product exactly when
stage 69 accepted it. The converse confirms the mechanism
(`examples/probes/comp-sensitive.cbl`, input `2500`, computing
`2500 * 4 = 10000` into a `PIC S9(4) COMP`):

| option set | `TOT` displays | branch taken |
|---|---|---|
| *(default)* | `+0000` | `BIG=NO` |
| `-fno-binary-truncate` | `+0000` | **`BIG=YES`** |
| `-std=ibm` | `+10000` | `BIG=YES` |

The middle row is the hazard in one line: **identical printed output,
different branch**. Layers A and B compare the KV stream and would see
two agreeing programs; only a layer reasoning about the *value* can tell
them apart. So dialect sensitivity is not merely a documentation
problem — it can be invisible to the dynamic evidence.

## The gap this exposed, and closing it

The certificate — the artifact a customer actually receives — recorded
**no compiler, no version, and no options at all**. The information
existed only in `benchmark/results.json`, which is a run artifact, not
the deliverable. `docs/certificate-guide.md` even told auditors the
dialect was "named in the run's toolchain record", which was true of the
benchmark and false of the certificate in their hands.

Closed here:

- **Harness images record their own build options.** Each
  `harness/gnucobol/Dockerfile*` takes a `COBFLAGS` build argument, uses
  it for every `cobc` compile, and writes it to
  `/opt/legacy/cobc-flags.txt` alongside the existing
  `cobc-version.txt`.
- **The runner captures the toolchain from the artifact, not from a
  declaration** — it reads those two files back out of the built image.
- **`certify --toolchain <file>` puts them inside the signed body.**
  Tamper-evidence verified: editing the recorded options to `-std=ibm`
  in a signed certificate makes `verify-cert` report
  `content hash does not match the canonical body` and REJECT.
- **Omission is loud.** A certificate produced without a toolchain
  record carries `toolchain.recorded: false`, an explanatory note, and a
  matching entry in `coverageEnvelope.gaps` — it never silently implies
  a dialect it did not check.
- The rendered report gains a **Reference compiler** row, and the
  auditor guide now points at the field instead of at a run artifact.

## What is still not done

Recording the dialect is not the same as *verifying against the
customer's* dialect. The pipeline still compiles with the pinned
defaults; `COBFLAGS` exists but nothing yet drives it from an
engagement's real build settings, and the frontend does not vary its
accepted subset by dialect. For a codebase built with `-std=ibm`, the
honest position today is:

- the certificate will correctly record that it was established under
  different options, and
- any `COMP`-bearing module in it is therefore **out of envelope** —
  the recorded mismatch is the disclosure, not a silent approximation.

The follow-on is a real stage: take the customer's compile options as a
pipeline input, build the harness with them, and **gate the subset on
them** — under binary-capacity truncation the IR's decimal model is
wrong for `COMP`, so those items would have to be rejected rather than
modelled, until a binary-capacity numeric model exists. That ordering
matters: accept the options first, gate on them second, model the
alternative semantics third.

## Probes

- `examples/probes/comp-sensitive.cbl` — the same source producing the
  same printed value and a different branch under different options.
- `examples/probes/comp-dialect.cbl` — display-vs-comparison divergence.
