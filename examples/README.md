# examples/ — demo corpus

## Purpose

A minimal end-to-end story: one real COBOL payroll program, two executables
standing in for "legacy binary" and "transpiled Java service", and two layer B
configs — one that catches a seeded defect, one that goes green.

## Contents

- `payroll.cbl` — fixed-format COBOL 85 payroll: overtime at 1.5x above 40
  hours, flat 22.5% tax with `ROUNDED` (half-up), `KEY=VALUE` output via
  DISPLAY. Parses with `legacymind parse`; compiles unmodified with
  `cobc -x -free=no payroll.cbl` once GnuCOBOL is available.
- `mock/legacy-payroll.mjs` — stand-in for the GnuCOBOL binary. Implements
  COBOL fixed-point semantics in exact integer math: truncation on
  unrounded COMPUTE, half-up on ROUNDED, edited-picture zero padding.
- `mock/modern-payroll.mjs` — stand-in for the transpiled Java service, with
  one **deliberate defect**: tax rounding uses HALF_EVEN (banker's rounding)
  instead of COBOL's half-up. This is the classic real-world COBOL→Java
  migration bug. `LEGACYMIND_FIX_ROUNDING=1` applies the fix.
- `payroll-diff.json` — layer B config, defective modern build. The
  `half-cent-tax-rounding` case (9.00 h × 5.00/hr → gross 45.00 → raw tax
  10.125) must FAIL: legacy says 10.13, modern says 10.12. Exit code 1.
  Also serves as the candidate-selection cases for `legacymind migrate`.
- `payroll-diff-fixed.json` — same cases, fixed modern build. All PASS,
  exit code 0.
- `payroll-prop.json` — layer A config: 200 seeded property-based cases
  generated from PAYROLL's data division, run against the **migrated
  candidate A** (`legacymind parse` + `migrate` must run first). All PASS.
- `payroll-prop-defect.json` — same generator against the **rejected
  candidate B**: property testing finds the half-cent rounding divergence
  from generated inputs alone and shrinks the counterexamples. Exit 1.
- `payroll-sym.json` — layer C config against candidate A: branch
  boundaries from IF conditions plus rounding half-boundaries derived by
  solving x·225 ≡ 500 (mod 1000). All realized obligations VERIFIED; the
  overtime-path realization is disclosed as UNREALIZED.
- `payroll-sym-defect.json` — layer C against candidate B: the solver
  derives the half-cent inputs exactly, so the divergence is caught
  deterministically (contrast with layer A's statistical hit). Exit 1.
- `payroll-{diff,prop,sym}-real.json` — the same three layers with the
  legacy side pointed at the REAL GnuCOBOL binary running sandboxed in
  Docker (build the image first: `harness/build-legacy-image.ps1`).
  Certificates should be issued from these.
- `mock-validation.json` — real GnuCOBOL binary vs the Node mock: the
  harness verifies its own test double (run with `--layer B` and
  `--layer A`). Bounds how far mock-based results can be trusted on
  machines without Docker.
- `payroll-static.json` — layer D config: static data-flow equivalence
  between the IR and migrated candidate A (no execution). All keys verify.
- `payroll-static-defect.json` — layer D against candidate B: the
  HALF_EVEN rounding defect is caught statically (the rounding-mode facet
  diverges) without running either program. Exit 1.

## Swapping in real executables

Replace the `argv` arrays: `["./payroll"]` for a cobc-compiled binary,
`["java", "-jar", "payroll.jar"]` for the real service. Nothing else changes.

## Failure modes

- The mocks assert specific GnuCOBOL behaviours (truncation points,
  intermediate precision, NUMVAL parsing, PIC storage capacity). They are
  **validated against real GnuCOBOL 3.1.2** via `mock-validation.json`
  (204/204 cases, curated + generated) — re-run that validation after any
  mock change. History note: the first validation run caught a real mock
  defect (missing PIC 9(7)V99 store truncation, 9/200 generated cases
  diverging) which also existed in the migrated Java; both were fixed and
  re-verified. Overflow semantics are now covered, not assumed.
- The mocks exit 3 on malformed numeric input, which layer B reports as a
  case ERROR — that is the intended loud path, not a bug.
