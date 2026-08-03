# Runbook — certifying the first real third-party module

Everything below is built and verified **except the one step that needs
model credentials**. This environment has none, so the last mile is
written down rather than run.

Target: **`CBACT02C`** from AWS CardDemo — untouched third-party COBOL
that reads an INDEXED (VSAM) card file and prints it.

## What is already proven

Against the real GnuCOBOL 3.1.2 binary reading a real VSAM file, with a
**hand-written** Java candidate:

| layer | result |
|---|---|
| A — property, 200 generated record sets | PASS 200/200 |
| B — curated, byte-for-byte (`raw`) | PASS 5/5 |
| C — symbolic | refuses: status-driven read loop (`docs/read-loop.md`) |
| D — static data-flow | NO-EVIDENCE: output is not `KEY=VALUE` |

So the harness, the loader, the record protocol and the certificate
envelope all work on code we did not write. **What is missing is a real
`migrate` run**, because a certificate over hand-written Java would prove
nothing about the pipeline.

## Prerequisites

1. **Credentials**: `ANTHROPIC_API_KEY`, or an `ant auth login` profile.
   Expect roughly the cost of two candidate generations (~$0.50 at the
   rates the SMOKE module measured).
2. **The CardDemo source**, which this repo deliberately does not vendor:

   ```bash
   git clone --depth 1 https://github.com/aws-samples/aws-mainframe-modernization-carddemo
   ```

3. **Copybooks staged extensionless** — ProLeap's literal `COPY 'NAME'`
   finder needs an exact filename match (`docs/real-code-assessment.md`,
   defect 1). Stage `CVACT02Y` alongside the module:

   ```bash
   mkdir -p examples/real
   cp <carddemo>/app/cbl/CBACT02C.cbl        examples/real/
   cp <carddemo>/app/cpy/CVACT02Y.cpy        examples/real/CVACT02Y
   ```

   `examples/real/` is gitignored on purpose: third-party source is staged,
   not vendored.

## The run

```bash
node cli/dist/main.js parse examples/real/CBACT02C.cbl --out out/real/ --engine proleap --copybooks examples/real
```

```bash
docker build -f harness/gnucobol/Dockerfile.indexed --build-arg SOURCE=examples/real/CBACT02C.cbl --build-arg LOADER=harness/gnucobol/cardfile-loader.cbl --build-arg IXFILE=CARDFILE --build-arg COPYDIR=examples/real -t legacymind/legacy-cbact02c .
```

```bash
node cli/dist/main.js migrate out/real/CBACT02C.ir.json --diff-config benchmark/real/cbact02c-diff.json --out out/real/cbact02c/migrate
```

That is the step that spends money and the only one not yet exercised.
It emits two candidates, compiles each with `javac`, runs layer B on each
and selects the first that passes. Add `--max-repairs 2` to let a failing
candidate see its own verifier evidence and try again.

Then the layers that do not need the model:

```bash
node cli/dist/main.js verify --layer A --config benchmark/real/cbact02c-prop.json --out out/real/cbact02c/layer-a.json
```

```bash
node cli/dist/main.js verify --layer D --config benchmark/real/cbact02c-static.json --out out/real/cbact02c/layer-d.json
```

Layer C is expected to **refuse** this module; run it anyway so the
refusal is on record, and pass no `--layer-c` to `certify`.

Capture the toolchain from the image rather than declaring it:

```bash
docker run --rm --entrypoint cat legacymind/legacy-cbact02c /opt/legacy/cobc-version.txt
```

Write those into `out/real/cbact02c/toolchain.json` in the shape
`benchmark/run-benchmark.mjs` uses, then:

```bash
node cli/dist/main.js certify --selection out/real/cbact02c/migrate/selection.json --layer-a out/real/cbact02c/layer-a.json --layer-d out/real/cbact02c/layer-d.json --toolchain out/real/cbact02c/toolchain.json --ir out/real/CBACT02C.ir.json --out out/real/cbact02c/certification.json
```

```bash
node cli/dist/main.js verify-cert out/real/cbact02c/certification.json
```

## What the certificate will and will not say

It will record **layer C as not run** and **layer D as providing no
evidence**, both with reasons, and it will carry the
`externalServices` disclosure for `CEE3ABD` plus the byte-window
disclosure. Verdict is `CERTIFIED` on layer B plus layer A.

That is a **weaker envelope than the benchmark's four-layer modules, and
the certificate says so on its face**. It is still the first signed
statement about code this project did not write, which is the thing worth
having.

Before showing it to anyone outside: **re-sign with a non-demo key.** The
committed demo key is for the benchmark, not for a customer-facing
artifact.
