# LegacyMind benchmark results

Generated 2026-07-17T10:17:39.546Z by `node benchmark/run-benchmark.mjs`.

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
| PAYROLL | 59 | candidate a of 2 | 4 cases | 200/200 (seed 20260705) | 2✓ 0✗ 0 unrealized | 2/2 | 4/4 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 88.7s |
| INTEREST | 53 | candidate a of 2 | 4 cases | 200/200 (seed 20260706) | 2✓ 0✗ 0 unrealized | 2/2 | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 87.4s |
| DISCOUNT | 54 | candidate a of 2 | 5 cases | 200/200 (seed 20260706) | 3✓ 0✗ 0 unrealized | 2/2 | 4/4 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 85.9s |
| LEDGER | 72 | candidate a of 2 | 6 cases | 200/200 (seed 20260707) | 5✓ 0✗ 0 unrealized | 4/4 (+2 dead) | 4/4 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 95.1s |
| COMPOUND | 52 | candidate a of 2 | 5 cases | 200/200 (seed 20260707) | 2✓ 0✗ 0 unrealized | 10/10 (+4 dead) | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 96.8s |
| TAXCALC | 58 | candidate a of 2 | 5 cases | 200/200 (seed 20260708) | 3✓ 0✗ 0 unrealized | 1/1 | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 82.4s |
| GRADE | 47 | candidate a of 2 | 5 cases | 200/200 (seed 20260709) | 2✓ 0✗ 1 unrealized | 2/2 (+2 dead) | 3/3 static (1 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 87.3s |
| COMMISSION | 49 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 2✓ 0✗ 0 unrealized | 2/2 | 2/2 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 109.3s |
| SENIOR | 38 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 2✓ 0✗ 1 unrealized | 2/2 (+2 dead) | 2/2 static (1 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 86.4s |
| TIER | 37 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 6✓ 0✗ 0 unrealized | 4/4 | 2/2 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 85.8s |
| INVOICE | 41 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 2✓ 0✗ 0 unrealized | 2/2 | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 82.1s |
| SHIPPING | 55 | candidate a of 2 | 6 cases | 200/200 (seed 20260709) | 3✓ 0✗ 0 unrealized | 3/3 | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 88.2s |
| TRANSFER | 52 | candidate a of 2 | 6 cases | 200/200 (seed 20260710) | 2✓ 0✗ 0 unrealized | 2/2 | 4/4 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 80.5s |
| RETAIL | 45 | candidate a of 2 | 6 cases | 200/200 (seed 20260710) | 3✓ 0✗ 0 unrealized | 2/2 | 5/5 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 82.9s |
| PAYSLIP | 55 | candidate a of 2 | 5 cases | 200/200 (seed 20260710) | 1✓ 0✗ 0 unrealized | 1/1 | 2/2 static (1 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 88.9s |
| BONUS | 46 | candidate a of 2 | 6 cases | 200/200 (seed 20260710) | 3✓ 0✗ 0 unrealized | 2/2 | 3/3 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 83s |
| BATCHSUM | 44 | candidate a of 2 | 5 cases | 200/200 (seed 20260710) | 0✓ 0✗ 2 unrealized | 6/8 | 2/2 static (1 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 84.4s |
| REBATE | 52 | candidate a of 2 | 7 cases | 200/200 (seed 20260711) | 2✓ 0✗ 2 unrealized | 15/39 | 3/3 static (2 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 99.9s |
| DUES | 35 | candidate a of 2 | 7 cases | 200/200 (seed 20260711) | 2✓ 0✗ 0 unrealized | 2/2 | 3/3 static (1 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 86.6s |
| TABSUM | 40 | candidate a of 2 | 5 cases | 200/200 (seed 20260711) | 1✓ 0✗ 1 unrealized | 1/1 | 2/2 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 80.9s |
| SETTLE | 41 | candidate a of 2 | 5 cases | 200/200 (seed 20260712) | 1✓ 0✗ 1 unrealized | 1/1 | 2/2 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 84.1s |
| LOCKER | 48 | candidate a of 2 | 6 cases | 200/200 (seed 20260714) | 2✓ 0✗ 0 unrealized | 2/2 | 4/4 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 88.1s |
| REMIT | 59 | candidate a of 2 | 6 cases | 200/200 (seed 20260714) | 1✓ 0✗ 0 unrealized | 1/1 | 2/2 static (1 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 96.1s |
| TARIFF | 60 | candidate a of 2 | 6 cases | 200/200 (seed 20260714) | 4✓ 0✗ 0 unrealized | 2/2 | 8/8 static (4 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 94.4s |
| MANIFEST | 69 | candidate a of 2 | 6 cases | 200/200 (seed 20260715) | 2✓ 0✗ 1 unrealized | 2/2 | 8/8 static | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 87.5s |
| REORDER | 63 | candidate a of 2 | 5 cases | 200/200 (seed 20260715) | 3✓ 0✗ 1 unrealized | 2/2 | 6/6 static (5 warn) | **CERTIFIED** | ✓ `9b70a354efb9feab` | $0.0000 | 88.6s |

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

**TRANSFER**

**RETAIL**

**PAYSLIP**
- layer D: 1 storage-capacity difference(s) flagged as warnings — statically inconclusive, covered dynamically by layers A/B/C

**BONUS**

**BATCHSUM**
- layer C: 2 obligation(s) could not be realized as inputs (see report)
- layer D: 1 storage-capacity difference(s) flagged as warnings — statically inconclusive, covered dynamically by layers A/B/C

**REBATE**
- layer C: 2 obligation(s) could not be realized as inputs (see report)
- layer C: 13 obligation-path combination(s) unrealized (see report)
- layer D: 2 storage-capacity difference(s) flagged as warnings — statically inconclusive, covered dynamically by layers A/B/C

**DUES**
- layer D: 1 storage-capacity difference(s) flagged as warnings — statically inconclusive, covered dynamically by layers A/B/C

**TABSUM**
- layer C: 1 obligation(s) could not be realized as inputs (see report)

**SETTLE**
- layer C: 1 obligation(s) could not be realized as inputs (see report)

**LOCKER**

**REMIT**
- layer D: 1 storage-capacity difference(s) flagged as warnings — statically inconclusive, covered dynamically by layers A/B/C

**TARIFF**
- layer D: 4 storage-capacity difference(s) flagged as warnings — statically inconclusive, covered dynamically by layers A/B/C

**MANIFEST**
- layer C: 1 obligation(s) could not be realized as inputs (see report)

**REORDER**
- layer C: 1 obligation(s) could not be realized as inputs (see report)
- layer D: 5 storage-capacity difference(s) flagged as warnings — statically inconclusive, covered dynamically by layers A/B/C

## Parser coverage against an external corpus

Corpus: https://github.com/uwol/proleap-cobol-parser (commit d1bfe75bdd6d), 759 files.

| Engine | Tier | Files | Rate |
|---|---|---|---|
| stub | parsed | 0 | 0.0% |
| proleap | front-end accepted (grammar + preprocessor) | 737 | 97.1% |
| proleap | IR-complete (every construct lowered) | 15 | 2.0% |

Front-end acceptance is what the production grammar and its
reference-format preprocessor handle; IR-complete is the stricter
tier the rest of the pipeline consumes today. Files in between
parse fine but use constructs the IR lowering does not model yet —
every one is enumerated per file, never skipped silently, and the
histogram below is the prioritized lowering backlog.

| Construct outside the IR subset | Occurrences |
|---|---|
| REDEFINES view "…" is numeric-edited, not elementary unsigned numeric DISPLAY (REDEFINES R1a) | 3218 |
| MOVE target "…" is subscripted but not a lowered table (O3 backlog) | 2607 |
| CLOSE of "…" which is not a lowered file | 951 |
| REDEFINES group view "…" over elementary target "…" (RG aligns group leaves to group leaves) | 911 |
| OPEN of "…" which is not a lowered file | 878 |
| WRITE with ADVANCING/END-OF-PAGE/INVALID KEY (outside file I/O stage 1) | 766 |
| GO TO FAIL-ROUTINE-WRITE inside PERFORM-reachable paragraph FAIL-ROUTINE is neither a structured ran | 750 |
| READ of "…" which is not a lowered file | 551 |
| SELECT PRINT-FILE ASSIGN TO a non-literal (XXXXX055) | 397 |
| FD PRINT-FILE without a matching LINE SEQUENTIAL SELECT | 397 |
| GO TO BAIL-OUT-WRITE inside PERFORM-reachable paragraph BAIL-OUT is neither a structured range early | 375 |
| GO TO CLOSE-FILES is a backward or self jump; only strictly forward top-level jumps are supported | 368 |
| SET target(s) TO a value other than TRUE (only SET condition-name TO TRUE or SET index TO n is suppo | 331 |
| PERFORM target "…" is not a paragraph in this program | 306 |
| PROCEDURE DIVISION has no paragraphs | 253 |

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
