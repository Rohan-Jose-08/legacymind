# ir-core/ — the Rust IR core

## Purpose

The founding spec puts the IR contract in Rust. `ir/schema.json` defines
the normalized form of one legacy module, but until this crate the
contract was enforced only by that schema and by whatever the TypeScript
consumers happened to read. `ir-core` makes the contract a **type**: an
IR document either deserializes into these structures or it does not, an
unknown statement kind is rejected by a closed enum rather than passed
through unmodeled, and `validate` checks the invariants the type system
cannot state (version pin, group/PICTURE exclusivity, known PICTURE
categories, nested statement arms).

The model is derived from the IR the frontend **actually emits** — the
statement kinds and data-item fields were extracted from the real
28-document IR set, not from the v0.1 schema prose (which predates
REDEFINES/OCCURS/INDEXED BY).

## First-increment scope (deliberate)

- **Typed:** the data division (items, decoded PICTUREs, REDEFINES /
  OCCURS / occursGroup / indexName markers) and every statement's
  `kind`. These are what the verifier reasons about.
- **Lossless but untyped:** statement bodies and the envelope (`module`,
  `controlFlow`, `provenance`, `files`) round-trip as JSON values.
  Deserialize → serialize reproduces the document exactly (asserted in
  tests as JSON-value equality) so the core can sit in the middle of the
  pipeline without becoming a lossy filter. Typing these is the named
  next increment, not a silent gap.

## The validator binary — ir-core as a pipeline gate

`src/bin/validate-ir.rs` turns the typed contract into an executable
gate: it parses and validates every IR path it is given, enumerates
every problem in every file (never just the first), and exits nonzero on
any failure. `ir-core/Dockerfile` packages it as the pinned
`legacymind/ir-core` image (multi-stage: the rust:1-slim toolchain
builds `--release --locked`; the runtime stage is the same slim Debian
base the legacy harness images use, carrying only the binary):

```
docker build -f ir-core/Dockerfile -t legacymind/ir-core .
docker run --rm -v "<abs>/out/ir:/ir:ro" legacymind/ir-core /ir/DUES.ir.json
```

The benchmark runner calls it as the `validate IR (rust ir-core)` step
immediately after every module's parse, so every emitted IR document is
checked against the typed contract before anything consumes it — and a
failed validation forces the module's verdict to PIPELINE-FAILED even if
downstream steps still produce a certificate. Verified both ways: all
real IR documents pass, and corrupted documents (an unknown statement
kind, a version bump, a group carrying a PICTURE) each fail loudly with
the specific reason and a nonzero exit.

## No host toolchain required

This machine has no host Rust; the crate builds and tests in the pinned
official container, the same pattern the harness uses for GnuCOBOL:

```
docker run --rm -v "<abs-repo-path>/ir-core:/crate" -w /crate rust:1-slim cargo test
```

(On Windows give the mount path with forward slashes, `C:/...`; from Git
Bash also set `MSYS_NO_PATHCONV=1` so `/crate` is not mangled.)

## Tests are against real artifacts

`tests/fixtures/` holds six real committed IR documents chosen to span
the surface: DUES (REDEFINES R1a), LOCKER (group REDEFINES RG), MANIFEST
(decomposed flat group table), REORDER (INDEXED BY index-name), PAYSLIP
(LINE SEQUENTIAL output file), REBATE (multi-field input record with a
byte layout). The suite asserts: every fixture parses; round-trips
byte-losslessly (as JSON values); validates; the fixtures genuinely span
the claimed constructs (a guard against the suite decaying into one
trivial shape); and an unknown statement kind is rejected.

Fixtures are snapshots. When the frontend's IR changes shape, regenerate
with `node cli/dist/main.js parse <module> --out out/ir/ --engine proleap`
and re-copy — a failing round-trip here is the drift alarm doing its job.

## Failure modes

- A document that fails to parse or validate is a frontend bug or a
  deliberate contract change — never something to paper over here.
- `IR_VERSION` is pinned; a bump is a migration, not a merge conflict to
  resolve silently.
