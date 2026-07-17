# LegacyMind

Autonomous modernization of legacy enterprise codebases (starting wedge:
COBOL 85 → Java 21 / Spring Boot) with **provable behavioural equivalence**.

We are not selling code generation — coding agents already do that. We sell
**verified correctness**: a certification report proving that every observable
behaviour of the legacy system is preserved on a definable coverage envelope,
with every remaining gap flagged, never hidden. The verification harness is
the product; the LLM behind the transpiler is a swappable commodity.

## Repository map

| Directory | Purpose | Status |
|---|---|---|
| `ir/` | The intermediate representation: `schema.json` (the contract between parser, transpiler, and all verifier layers) plus worked examples | **built** |
| `cli/` | The `legacymind` command — `assess` (customer codebase assessment: per-module verifiability verdicts, copybook intake, unlock-ranked blocker table), `parse`, `plan`, `migrate` (with bounded verifier-evidence repair rounds via `--max-repairs`), `verify` (layers A–D), `certify` (Ed25519-signed), `verify-cert`, `report` | **built** |
| `keys/` | Certificate signing material: a committed, clearly-labeled **demo** Ed25519 key so signing is reproducible offline; production keys stay out of the repo. See `keys/README.md` | **built** |
| `verifier/` | The moat: all four verification layers implemented — A (property-based + shrinking), B (differential execution), C (symbolic-execution prototype), D (static data-flow equivalence via the javac-based `verifier/javaflow` extractor); see `verifier/README.md` | **all four layers built** |
| `transpiler/` | LLM modernization behind a driver-agnostic `ModelClient`: hashed replay cache, two prompt-variant candidates per module, `javac` compile, verifier-driven selection | **built (MVP)** |
| `examples/` | Demo corpus: `payroll.cbl`, mock legacy/modern executables, diff-exec and property-gen configs | **built** |
| `benchmark/` | Reproducible multi-module benchmark vs real GnuCOBOL — **26/26 certified + Ed25519-verified, both sides sandboxed in pinned containers, IR validated by the Rust core on every run** — + external parser-coverage sweep; see `benchmark/RESULTS.md` and the 8-finding log in `benchmark/README.md` | **built** |
| `parser/` | Production ingestion: `parser/proleap` runs the ProLeap ANTLR4 COBOL85 grammar + reference-format preprocessor (JVM, jars committed) and lowers the ASG to IR — 97.1% front-end acceptance on the 759-file external corpus (vs stub's 0%); wave 1 added arithmetic verbs, period-terminated IF, level-77, EXIT, FILLER; wave 2 PERFORM TIMES/UNTIL/VARYING loops; wave 3 PERFORM THRU ranges; plus 88-level condition names, EVALUATE, GO TO subsets, file I/O stages 1–2b, REDEFINES (R1a + group RG), the OCCURS family (numeric/X/flat-group/INDEXED BY + SET), WRITE FROM, compound-condition search enumeration, and COPY expansion with sound span provenance. The Rust IR core is **built** (`ir-core/`: the typed contract + the `validate-ir` pipeline gate) | **built (frontend + 20+ lowering waves + Rust core)** |
| `harness/` | Sandboxed execution, **both sides**: the GnuCOBOL image (program compiled in at build time; `--network none`, `--rm`, libfaketime) and the pinned OpenJDK 21 image for the modern candidate (`LM_JAVA_IMAGE`, persistent fast mode) — the published benchmark runs fully sandboxed | **built (both sides)** |
| `dashboard/` | Next.js 15 + Tailwind 4 verification dashboard behind WorkOS SSO: per-module status, coverage envelope, cost meter, unverified branches, evidence downloads, and **server-side Ed25519 signature verification** (a tampered certificate shows a red badge, not a silent pass) | **built (v1)** |

## Quickstart (the demo)

```
cd legacymind
npm --prefix cli install
npm --prefix cli run build

# 1. COBOL -> IR (add --engine proleap for the production ANTLR4 parser;
#    both engines emit identical IR for sources in the stub's subset)
node cli/dist/main.js parse examples/payroll.cbl --out out/ir/

# 2. Scope + cost estimate before any model call
node cli/dist/main.js plan out/ir/PAYROLL.ir.json

# 3. Migrate: two LLM candidates (replayed from the shipped cache), javac,
#    layer B + layer A gate on each — candidate B fails, A wins
node cli/dist/main.js migrate out/ir/PAYROLL.ir.json --diff-config examples/payroll-diff.json --prop-config examples/payroll-prop.json --out out/migrate --offline

# 4. Layer A: 200 generated cases vs the winning candidate (all green)
node cli/dist/main.js verify --layer A --config examples/payroll-prop.json --out out/property-report.json

# 5. Layer C: symbolic prototype — branch boundaries + congruence-solved
#    rounding half-boundaries; the unrealizable overtime path is disclosed
node cli/dist/main.js verify --layer C --config examples/payroll-sym.json --out out/symexec-report.json

# 6. Certify: aggregate A+B+C evidence into the sellable artifact (signed
#    with the demo key), verify the signature, then render it human-readable
node cli/dist/main.js certify --selection out/migrate/selection.json --layer-a out/property-report.json --layer-c out/symexec-report.json --out out/certification.json
node cli/dist/main.js verify-cert out/certification.json
node cli/dist/main.js report out/certification.json --out out/certification.md

# (defect demos) layers A and C pointed at the REJECTED candidate B —
# A rediscovers the rounding bug statistically and shrinks it; C derives
# the half-cent inputs exactly and fails deterministically (exit 1):
node cli/dist/main.js verify --layer A --config examples/payroll-prop-defect.json --out out/property-report-defect.json
node cli/dist/main.js verify --layer C --config examples/payroll-sym-defect.json --out out/symexec-report-defect.json

# (stage-1 demo) Layer B with curated cases against the mocks:
node cli/dist/main.js verify --config examples/payroll-diff.json --out out/diff-report.json
node cli/dist/main.js verify --config examples/payroll-diff-fixed.json --out out/diff-report-fixed.json
```

## Design decisions made this session (defensible defaults, flagged loudly)

1. **Two parse engines, one IR contract.** The TypeScript stub remains the
   zero-dependency baseline; the production engine (`parser/proleap`, ProLeap
   ANTLR4 grammar + reference-format preprocessor on the JVM) is selected
   with `parse --engine proleap` and is the benchmark default. Both are
   cross-validated to emit identical IR (modulo provenance) inside the
   stub's subset, so the committed transpiler replay cache serves either.
   The ASG→IR lowering currently lives in Java
   (`parser/proleap/src/ProLeapFrontend.java`); the non-negotiable Rust IR
   core is still planned and slots in behind the same `ir/schema.json`
   contract.
2. **Mocks stand in for the COBOL binary and the Java jar.** This machine has
   no GnuCOBOL. The layer B harness is command-agnostic (`argv` in config), so
   swapping in `cobc -x` output and `java -jar` is a config edit, not code.
   The legacy mock documents exactly which COBOL semantics it asserts
   (truncation, ROUNDED=half-up, edited-picture output) — those assertions
   must be validated against real GnuCOBOL before layer B numbers are trusted.
3. **Output contract is `KEY=VALUE` stdout lines** ("kv-lines"). Trivial to
   emit from COBOL `DISPLAY` and from Java, trivially diffable field-by-field.
   Record/file-based protocols come with real trace capture.
4. **Layer B lives in `cli/src/verify/` for now** so the MVP is one buildable
   package with zero runtime dependencies. It extracts into `verifier/` when
   layers A/C/D land. `verifier/README.md` is the authoritative design doc.
5. **The default demo exits 1.** The modern mock carries a deliberate
   HALF_EVEN-vs-HALF_UP rounding defect — the classic COBOL→Java migration
   bug. The harness catching it *is* the demo. The `-fixed` config shows the
   green path.
6. **Candidates are prompt-variant-diverse, not temperature-diverse.** The
   founding spec predates current Claude models (Opus 4.7+), which removed
   sampling parameters from the API; two prompt variants (faithful /
   idiomatic) replace two temperatures.
7. **The shipped transpiler cache is pre-recorded** so `migrate --offline`
   works air-gapped: candidate A is a correct translation, candidate B
   deliberately preserves the representative HALF_EVEN defect so the
   verifier-driven selection loop has something real to catch. With live
   credentials and a cold cache, `migrate` generates fresh candidates.
   See `transpiler/README.md`.
8. **Plain Java 21, not Spring Boot, for batch-shaped modules.** PAYROLL is
   a stdin/stdout program; a web framework would change observable behavior.
   Spring Boot scaffolding arrives with service-shaped modules.
9. **Layer C is a path-sensitive symbolic engine with exact rounding
   semantics (v3).** Exact-rational affine execution; rounded stores are
   tracked as exact forms and inverted at boundaries (including the exact
   half point where HALF_UP and HALF_EVEN part ways); nonlinear products
   are linearized at path-witness fixing points; infeasible paths are
   proven, not guessed. On the benchmark this leaves zero unrealized
   obligations — remaining per-path disclosures are values nested through
   two rounded stores or nonlinear producers, which need recursive
   inversion (a full SMT encoding) and are listed in each certificate.
10. **Certificates are Ed25519-signed and independently verifiable.**
    `certify` signs the canonical certificate body; `verify-cert` checks
    the signature (tamper-evidence) and pins the signer's public key
    (provenance), exiting non-zero on any edit or unknown signer. The
    benchmark re-verifies every certificate it issues. Signing uses a
    committed **demo** key (`keys/`, clearly labeled, grants access to
    nothing) so the demo is reproducible offline; production passes a
    KMS-held key via `--signing-key`. The signature covers a sorted-key
    canonical form, so a certificate can be re-serialized and still
    verify. The dashboard verifies signatures server-side too, so a
    tampered certificate is flagged in the UI rather than shown as valid.
11. **Dashboard v1 uses WorkOS AuthKit** (founder decision, 2026-07-05) in
    secure-by-default middleware mode — every route except the OAuth
    callback requires a session. It is a read-only viewer over the
    pipeline's `out/` artifacts. One manual step remains: register
    `http://localhost:3000/callback` as a redirect URI in the WorkOS
    dashboard. See `dashboard/README.md`.

## Non-negotiables (from the founding spec)

- TypeScript for orchestration, Rust for the IR layer, Java for target-side
  tooling. No Python in the hot path.
- Every LLM call cached, hashed, replayable; cost is a first-class metric.
- The verifier runs air-gapped. (Already true: `parse` and `verify` make zero
  network calls.)
- No hidden failures — unverifiable modules are reported loudly.
- Every generated file carries a provenance trail. (Already true: IR embeds
  source SHA-256 + line spans; diff reports embed config and artifact hashes.)

