# LegacyMind benchmark results

Generated 2026-07-10T08:08:32.459Z by `node benchmark/run-benchmark.mjs`.

Every module below was parsed to IR, migrated to Java 21 by the
transpiler (two prompt-variant candidates, replayed from the committed
cache), and verified **against the real GnuCOBOL 3.1.2 binary running
sandboxed in Docker** — no mocks anywhere in this table. CERTIFIED
means layer B plus every other run layer (A, C, D) passed on the
selected candidate; every disclosed gap is listed in the certificate.
Each certificate is Ed25519-signed and re-verified against the trusted
key in the same run — the **Signed** column is that check, so a
tampered or wrongly-signed certificate would fail the benchmark.

| Module | COBOL lines | Winner | Layer B | Layer A (seeded) | Layer C obligations | Paths | Layer D keys | Verdict | Signed | LLM cost | Wall time |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PAYROLL | 59 | candidate a of 2 | 4 cases | 200/200 (seed 20260705) | 2✓ 0✗ 0 unrealized | 2/2 | 4/4 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 72s |
| INTEREST | 53 | candidate a of 2 | 4 cases | 200/200 (seed 20260706) | 2✓ 0✗ 0 unrealized | 2/2 | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 71.1s |
| DISCOUNT | 54 | candidate a of 2 | 5 cases | 200/200 (seed 20260706) | 3✓ 0✗ 0 unrealized | 2/2 | 4/4 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 75.1s |
| LEDGER | 72 | candidate a of 2 | 6 cases | 200/200 (seed 20260707) | 5✓ 0✗ 0 unrealized | 4/4 (+2 dead) | 4/4 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 72.2s |
| COMPOUND | 52 | candidate a of 2 | 5 cases | 200/200 (seed 20260707) | 2✓ 0✗ 0 unrealized | 10/10 (+4 dead) | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 69.2s |
| TAXCALC | 58 | candidate a of 2 | 5 cases | 200/200 (seed 20260708) | 3✓ 0✗ 0 unrealized | 1/1 | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 73.2s |
| GRADE | 47 | candidate a of 2 | 5 cases | 200/200 (seed 20260709) | 2✓ 0✗ 1 unrealized | 2/2 (+2 dead) | 3/3 static (1 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 62.5s |
| COMMISSION | 49 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 2✓ 0✗ 0 unrealized | 2/2 | 2/2 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 66s |
| SENIOR | 38 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 2✓ 0✗ 1 unrealized | 2/2 (+2 dead) | 2/2 static (1 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 64.2s |
| TIER | 37 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 6✓ 0✗ 0 unrealized | 4/4 | 2/2 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 67.9s |
| INVOICE | 41 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 2✓ 0✗ 0 unrealized | 2/2 | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 62.2s |
| SHIPPING | 55 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 2✓ 0✗ 1 unrealized | 3/3 | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 65.5s |

## Disclosed gaps per certificate

**PAYROLL**
- layer C: 1 obligation-path combination(s) unrealized (see report)

**INTEREST**

**DISCOUNT**
- layer C: 2 obligation-path combination(s) unrealized (see report)

**LEDGER**
- layer C: 3 obligation-path combination(s) unrealized (see report)

**COMPOUND**

**TAXCALC**

**GRADE**
- layer C: 1 obligation(s) could not be realized as inputs (see report)
- layer D: 1 storage-capacity difference(s) flagged as warnings — statically inconclusive, covered dynamically by layers A/B/C

**COMMISSION**

**SENIOR**
- layer C: 1 obligation(s) could not be realized as inputs (see report)
- layer D: 1 storage-capacity difference(s) flagged as warnings — statically inconclusive, covered dynamically by layers A/B/C

**TIER**

**INVOICE**

**SHIPPING**
- layer C: 1 obligation(s) could not be realized as inputs (see report)

## Parser coverage against an external corpus

Corpus: C:/Users/Ender/AppData/Local/Temp/claude/C--Users-Ender-startup/7a40dc33-ad23-428b-805e-9e71bcc7aa45/scratchpad/proleap-cobol-parser (commit d1bfe75bdd6d), 759 files.

| Engine | Tier | Files | Rate |
|---|---|---|---|
| stub | parsed | 0 | 0.0% |
| proleap | front-end accepted (grammar + preprocessor) | 737 | 97.1% |
| proleap | IR-complete (every construct lowered) | 8 | 1.1% |

Front-end acceptance is what the production grammar and its
reference-format preprocessor handle; IR-complete is the stricter
tier the rest of the pipeline consumes today. Files in between
parse fine but use constructs the IR lowering does not model yet —
every one is enumerated per file, never skipped silently, and the
histogram below is the prioritized lowering backlog.

| Construct outside the IR subset | Occurrences |
|---|---|
| GO_TO statement | 18947 |
| REDEFINES | 4326 |
| MOVE target "…" (qualified/subscripted) | 3432 |
| WRITE statement | 1123 |
| CLOSE statement | 969 |
| OPEN statement | 966 |
| SET statement | 927 |
| READ statement | 767 |
| OCCURS | 555 |
| PERFORM target "…" is not a paragraph in this program | 500 |
| FILE SECTION | 432 |
| sections in the PROCEDURE DIVISION | 413 |
| PROCEDURE DIVISION has no paragraphs | 257 |
| ADD receiving field "…" (qualified/subscripted) | 230 |
| START statement | 186 |

## Reproduction

```
cd legacymind
npm --prefix cli install && npm --prefix cli run build
node benchmark/run-benchmark.mjs            # requires Docker
node benchmark/parse-sweep.mjs <corpus-dir> # optional external sweep
```

Candidates replay from `transpiler/cache/` (committed), so the run is
offline and deterministic; layer A seeds are fixed and recorded in each
report. Certificates and layer reports land in `out/bench/<module>/`.
