# cli/ — the `legacymind` command

## Purpose

Discrete, inspectable pipeline stages so customers can audit every
intermediate artifact. All six stages are implemented: `parse`, `plan`,
`migrate`, `verify` (layers A, B, C), `certify`, `report`.

Dependency policy: `parse` and `verify` run with **zero** network-facing
code — the Anthropic SDK is a runtime dependency but is loaded lazily and
only by `migrate` on a cache miss (air-gap requirement: the verifier never
touches it). Dev dependencies are TypeScript and Ajv only.

## Build

```
npm install
npm run build        # tsc -> dist/
npm test             # validates ir/examples against ir/schema.json
```

## Commands

### `legacymind parse <source.cbl> --out <dir | file.json>`

Parses fixed-format COBOL 85 into LegacyMind IR (`../ir/schema.json`).
When `--out` is a directory the output is `<PROGRAM-ID>.ir.json`.
Supported subset and loud-failure rules: see `src/parse/parser.ts` header.

### `legacymind plan <ir.json | ir-dir> [--model claude-opus-4-8]`

Module inventory plus a clearly-labeled rough LLM cost estimate (chars/4
tokens) for a two-candidate migrate pass. Real metering happens in
`migrate`.

### `legacymind migrate <ir.json> --diff-config <cfg> --out <dir> [--prop-config <cfg>] [--model m] [--cache dir] [--offline]`

Emits two prompt-variant Java 21 candidates through the replay cache
(`--cache`, default `transpiler/cache`), compiles each with
`javac --release 21`, runs verifier layer B on each using the
`--diff-config` cases, and selects the first passing candidate. With
`--prop-config`, winning additionally requires passing that config's
layer A generated cases — candidates cannot overfit the curated suite.
Artifacts: `candidate-{a,b}/<Class>.java` (+ `.class`), per-candidate diff
reports, `selection.json` with cache keys, costs, and the winner.
`--offline` forbids live calls — a cache miss then writes a
`<key>.request.json` stub and fails loudly (record it with
`scripts/record-response.mjs`). See `../transpiler/README.md`.

### `legacymind verify --config <cfg> --out <report.json> [--layer A|B|C|D] [--count N] [--seed S]`

Layer B (default): differential execution of the config's curated cases.
Layer A: property-based cases generated from the data division per the
config's `generator` block, with counterexample shrinking.
Layer C: symbolic-execution prototype per the config's `symbolic` block —
path enumeration plus boundary obligations derived by constraint solving.
Layer D: static data-flow equivalence per the config's `static` block —
IR vs migrated Java via the javac-based extractor, no execution.
See `../verifier/README.md` for config and report formats.

### `legacymind certify --selection <selection.json> --out <certification.json> [--layer-a <r>] [--layer-c <r>] [--layer-d <r>]`

Aggregates the winner's layer B report plus any provided layer A/C/D
reports into `certification.json`: per-layer verdicts, the coverage
envelope, every gap listed (unrealized obligations, unresolved keys,
capacity warnings, layers not run, mock-legacy caveat, artifact
mismatches), and an integrity hash. CERTIFIED requires layer B plus at
least one other layer passing on the same target. Exit 1 when
NOT_CERTIFIED.

### `legacymind report <certification.json> [--out <file.md>]`

Renders a certificate as human-readable Markdown (stdout by default).

## Exit codes

- `0` — success (`verify`: every case passed; `migrate`: a candidate won;
  `certify`: CERTIFIED)
- `1` — verification FAIL, no passing candidate, or NOT_CERTIFIED
- `2` — usage, configuration, parse, or model-resolution error

## Failure modes

- **Parse errors are line-numbered and fatal.** The stub parser rejects
  everything outside its subset instead of emitting incomplete IR.
- **Model calls never fail silently**: cache misses without credentials
  name the exact cache key and write the request stub for recording.
- `--out` paths are created recursively; existing files are overwritten
  without prompting (stages are meant to be re-runnable).
- On Windows, verify/migrate executables must be real binaries (`node`,
  `java`, `.exe`); `.cmd` shims are rejected by Node's spawn hardening.
- This package is the orchestration layer. The production parser (ProLeap
  ANTLR4, JVM + Rust IR core) replaces `src/parse/`; verifier layers
  extract into `../verifier/` as C/D land.
