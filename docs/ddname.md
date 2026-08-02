# ddnames — the file binding is deployment, not semantics

`SELECT ... ASSIGN TO CARDFILE` names a **ddname**, not a path. On z/OS a
JCL `DD` statement maps it to a dataset; nothing in the COBOL says which
one. The subset previously required a quoted literal, which rejected
**every file assignment in real code**.

## Measured

In AWS CardDemo: **49 of 49 `ASSIGN` clauses are ddnames. Zero literals.**
The literal-only rule was not a conservative subset — it excluded 100% of
real file I/O, and did so at the `SELECT`, which then cascaded into
"FD without a matching lowered SELECT" and `OPEN` / `CLOSE` / `READ`
"of a file that is not lowered". One artificial restriction, five
reported blockers per file.

## Ground truth (GnuCOBOL 3.1.2, pinned container)

GnuCOBOL implements the mainframe convention: the ddname is resolved
**at run time from the environment**, and falls back to a file of that
name in the working directory (`examples/probes/ddname.cbl`):

| environment | file actually used |
|---|---|
| `DD_MYDD=/tmp/via-dd.txt` | `/tmp/via-dd.txt` |
| `dd_MYDD=/tmp/via-lc.txt` | `/tmp/via-lc.txt` |
| `MYDD=/tmp/via-plain.txt` | `/tmp/via-plain.txt` |
| *(nothing set)* | a file named `MYDD` in the CWD |

`OPEN` returns status `00` in every case. So the ddname is an **external
binding**, exactly like the JCL it stands in for.

## The model, and what is *not* claimed

A ddname is accepted and recorded, with `assignKind: "ddname"` in the
IR's file entry to distinguish it from a literal path. Nothing else in
the file subset changes.

**The binding itself is not verified, and the certificate should not be
read as if it were.** Equivalence is a claim about the program *given* a
binding: both sides are handed the same records by the harness, and if
the customer's JCL points the ddname at a different dataset, that is a
deployment fact no source-level verification can see. This is the same
shape as the dialect disclosure (docs/dialect.md) — a property of the
environment, not of the code, and therefore something to state rather
than assume.

`assignKind` is emitted **only** for ddnames. A literal `ASSIGN` keeps
the exact IR it always had, so the committed replay-cache keys (which
hash the IR into the transpiler prompt) remain valid for every existing
module — verified by re-parsing the file-bearing benchmark modules and
diffing.

## Measured effect

On CardDemo, accepting ddnames removed the `ASSIGN`-non-literal blocker
across the file-using modules and, more importantly, **unmasked what was
underneath**: `ACCESS MODE RANDOM`, organizations outside the lowered
set, and READ-site structure. Median blockers per module **22.0 → 18.0**,
the largest single-stage drop so far, and the nearest realistic module
(`CBACT02C`) went from 11 blockers to 8.

VERIFIABLE remains 0/31. As with every stage since the real-code
assessment, removing one restriction moves the wall rather than
breaching it.

## What the unmasking revealed

Two shapes worth naming, both now visible for the first time:

- **`ACCESS MODE RANDOM`** on indexed files — the keyed-read residual
  already scoped in docs/vsam.md, now confirmed as the dominant real
  access mode rather than a corner case.
- **`READ ... INTO` a differently-shaped group** — the FD record is a
  flat `PIC X(n)` and the target carries the real field structure (2
  record leaves vs 7 target leaves in `CBACT02C`). VSAM V1 requires
  one-to-one leaf alignment, which this idiom deliberately does not
  have. It is a **byte-offset** decomposition, and the stage-2b layout
  model already computes exactly those offsets — so this is a
  well-shaped follow-on rather than a new mechanism.

## Probe

- `examples/probes/ddname.cbl` — ddname resolution through `DD_*`,
  `dd_*`, the bare name, and the no-environment fallback.
