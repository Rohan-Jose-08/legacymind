# ir/ — the LegacyMind intermediate representation

## Purpose

`schema.json` (JSON Schema, draft 2020-12) defines the normalized form of one
legacy module. It is the contract between every other component: the parser
emits it, the transpiler consumes it, and all four verifier layers read it.
Parser implementations are disposable; documents must always validate against
this schema. It is deliberately independent of any LLM's context format.

## Inputs / outputs

- Input: none (this directory is pure data).
- Output: `schema.json` plus worked examples under `examples/`.
- `examples/calculate-pay.cbl` is the canonical 20-line COBOL paragraph;
  `examples/calculate-pay.ir.json` is its parsed IR (regenerate with
  `node ../cli/dist/main.js parse examples/calculate-pay.cbl --out examples/calculate-pay.ir.json`,
  validate with `npm --prefix ../cli test`).

## What the IR captures (v0.1)

- **module** — PROGRAM-ID, dialect, source path + SHA-256 (provenance anchor).
- **dataDivision** — the WORKING-STORAGE tree. Each item keeps its raw
  PICTURE string *and* a decoded type (`category`, `digits`, `scale`,
  `signed`). `scale` is load-bearing: it is what layer A uses to generate
  property ranges and what layers B/D use for COMP-3 ↔ BigDecimal tolerance.
- **procedureDivision** — paragraphs of typed statements (`move`, `compute`,
  `if`, `perform`, `display`, `accept`, `stop-run`, `goback`). Every
  statement carries its raw source text and a file/line span, so provenance
  survives into every generated Java file and every verifier counterexample.
  `compute` records the `rounded` flag explicitly because COBOL ROUNDED
  (half-up) vs Java HALF_EVEN defaults is the single most common migration
  defect class.
- **controlFlow** — paragraph-level CFG with `fallthrough` and `perform`
  edges. Statement-level CFG and PERFORM-return modeling are planned
  extensions needed by layer C (symbolic execution).
- **provenance** — parser name/version, timestamp, and a warnings list that
  must name anything the parser saw but did not model.

## Worked example (COBOL ↔ IR)

```cobol
COMPUTE WS-TAX ROUNDED = WS-GROSS-PAY * WS-TAX-RATE
```

becomes

```json
{
  "kind": "compute",
  "target": "WS-TAX",
  "rounded": true,
  "expression": {
    "text": "WS-GROSS-PAY * WS-TAX-RATE",
    "refs": ["WS-GROSS-PAY", "WS-TAX-RATE"]
  },
  "text": "COMPUTE WS-TAX ROUNDED = WS-GROSS-PAY * WS-TAX-RATE",
  "span": { "file": "ir/examples/calculate-pay.cbl", "startLine": 31, "endLine": 31 }
}
```

See `examples/calculate-pay.ir.json` for the full document, including the
IF/ELSE branch structure and the decoded PICTURE types.

## Known v0.1 limits (loud, not hidden)

- Expressions and conditions are raw text plus resolved references
  (`operandExpr`), not a full AST. A typed expression tree replaces this when
  the ProLeap-based parser lands; `refs` already supports layer D data-flow
  diffing.
- No REDEFINES / OCCURS / 88-levels / FILE SECTION / linkage — the stub
  parser rejects them with line-numbered errors rather than emitting
  incomplete IR.

## Failure modes

- A document that fails schema validation means a parser bug or a schema
  drift — CI must run `cli/scripts/validate-ir.mjs` on every emitted IR.
- `irVersion` is pinned (`const`); a version bump is a deliberate migration,
  never silent.
