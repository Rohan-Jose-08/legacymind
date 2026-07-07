# verifier/ — the moat

## Purpose

Four independent verification layers, each producing evidence. A module is
certified only from accumulated evidence, and every gap is reported loudly.
This directory holds the authoritative design doc plus the Java-side
extractor (`javaflow/`); the TypeScript layer implementations live in
`../cli/src/verify/` (`propgen.ts`, `diffexec.ts`, `symexec.ts`,
`staticflow.ts`).

| Layer | Technique | Status |
|---|---|---|
| **A** | **Property-based tests generated from the COBOL data division (PICTURE types drive generators; run against both systems; divergences shrunk to smaller counterexamples)** | **built** |
| **B** | **Differential execution: replay captured or synthetic traces through both systems, diff outputs field-by-field with numeric tolerances** | **built** |
| **C** | **Path-sensitive symbolic execution: exact-rational affine stores, per-path constraint systems, boundary obligations solved through accumulator chains, path witnesses; any diverging case is a fail** | **built (v2)** |
| **D** | **Static data-flow equivalence: per output key, compare the derivation (input positions, constants, rounding modes, decimal shifts) between the IR and the migrated Java — no execution** | **built (prototype)** |

Final output: `legacymind certify` aggregates the layer reports into
`certification.json` — pass/fail per layer, the coverage envelope, every
gap listed, and an integrity hash over the certificate body (org-key/PKI
signing planned). `legacymind report` renders it as Markdown. A certificate
is issued only when layer B plus at least one other layer pass on the same
target artifact; a report that tested a different candidate is flagged.

## Layer A — property-based testing

`legacymind verify --layer A --config <cfg> --out <report> [--count N] [--seed S]`

Layer B proves behavior on known-important traces; layer A hunts for
divergence in the input space nobody wrote a case for. It reuses layer B's
execution contract and comparison rules; only case *origin* differs.

### Inputs

A diff-exec config (same `legacy`/`modern`/tolerance fields as layer B)
plus a `generator` block instead of curated `cases`:

```jsonc
"generator": {
  "ir": "../out/ir/PAYROLL.ir.json",          // module IR (relative to config)
  "stdinFields": ["WS-EMP-ID", "WS-HOURS-WORKED", "WS-HOURLY-RATE"],
  "count": 200,
  "seed": 20260705
}
```

`stdinFields` maps each stdin line to a data-division item; that item's
PICTURE defines the value domain (digits/scale for numerics, length for
alphanumerics). Numeric generation is boundary-biased (~20% of draws are
zero, max, or small values) because that is where truncation, rounding, and
overflow defects live.

### Determinism and shrinking

Cases come from a seeded PRNG: identical seed + count + IR reproduce
identical cases, so a certification run is repeatable. The seed and the IR's
SHA-256 are embedded in the report. Failures are shrunk by greedily
simplifying numeric inputs (toward 0, 1, integers, halves, tenths) while the
divergence persists — bounded at 30 extra runs per failure, first 5 failures.

### Output

`--out report.json`: verdict, generated/passed/failed/errored counts, the
generator settings, and every failure with its original stdin, field diffs,
raw outputs, and the shrunk counterexample. Exit 0 only when all pass.

### Failure modes — layer A specific

- **Coverage is statistical, not exhaustive.** 200 samples of a rare edge
  (the demo defect fires on ~2.5% of inputs) will usually — not always —
  hit it. Raise `--count` for rarer edges; layer C (symbolic) exists for
  the paths sampling can't reach.
- The generator only explores the fields listed in `stdinFields`; input
  structure beyond one-value-per-line (records, files, transactions) waits
  on real trace capture.
- Generated values can exceed what real COBOL storage would hold
  (PIC overflow semantics: high-order digits silently drop on store when
  no ON SIZE ERROR is declared). This class is now exercised for real:
  running layer A against the GnuCOBOL harness image exposed exactly this
  divergence in both the mock and the first migrated candidate (9/200
  cases); both were fixed and re-verified against the real binary. The
  episode is the layer working as designed — boundary-biased generation
  plus a real reference implementation.

## Layer C — path-sensitive symbolic execution

`legacymind verify --layer C --config <cfg> --out <report>`

Where layer A samples, layer C **derives** the inputs that matter and is
deterministic: same IR, same obligations, same cases, every run.

### What the engine does (v3: path-sensitive, exact rounding semantics)

1. **Affine symbolic execution** — PERFORMs are inlined from the CFG
   entry and every statement executes over an exact-rational affine
   store: each variable is `c0 + Σ ci·xi` over the stdin inputs (BigInt
   fractions, no floats). IF forks carry their condition as an affine
   constraint — variable-vs-variable conditions included — so every
   path (capped at 64) has a solvable constraint system.
2. **Exact rounding forms** — a rounded/truncating store produces both a
   fuzz-bounded affine approximation (½ulp per ROUNDED store, 1ulp per
   truncation) *and*, one rounding level deep, an exact structure
   `affine + Σ k·round_mode,scale(inner)`. Where the exact form exists,
   constraints are **decided exactly** at any concrete assignment — no
   fuzz margin — which is what allows sitting test cases directly on a
   rounded boundary. Where it doesn't, the fuzz margin keeps decisions
   sound.
3. **Money-touching detection** — `COMPUTE ... ROUNDED` statements whose
   target or operands match the `moneyPattern` regex (IBM copybook naming
   conventions by default) or explicit `annotations`. Lowered arithmetic
   verbs (ADD/SUBTRACT/MULTIPLY/DIVIDE ... ROUNDED) arrive as computes
   and are analyzed identically.
4. **Boundary obligations, solved per path** (the same condition or
   expression can be affine on one path and degenerate on another):
   - *branch boundaries*: each condition's decision value is driven to
     boundary−ulp / boundary / boundary+ulp by linear solving on the
     PICTURE grid — through derived-variable chains, accumulators, and
     **through rounded stores**, by inverting the rounding exactly
     (`round(y) = v ⟺ y ∈ [v−½ulp, v+½ulp)`), including the exact half
     endpoint where HALF_UP and HALF_EVEN part ways;
   - *rounding half-boundaries*: for each affine ROUNDED expression, the
     inputs landing it exactly on a half-unit at the target scale, by
     affine congruence solving (`k·x ≡ h (mod m)` with fixed terms);
   - *nonlinear products* (`a * b * c / k`): linearized by fixing all
     factors but one at the path's witness values — which satisfy the
     path constraints by construction — then congruence-solved. The v1
     producer-inversion heuristic remains as final fallback; whatever
     still cannot be realized is reported **UNREALIZED, per path** and
     flows into the certificate's gaps.
5. **Path witnesses and proven infeasibility** — each path's constraint
   system is solved outright, so coverage is a first-class result.
   A path with a failing *constant* constraint is proven infeasible
   (dead code) and reported as such — proof, not a failed search.
   Witnesses are solved before obligations so their assignments seed the
   obligation solver with in-path fixing points.
6. Every realized case runs through the shared differential harness.

### Config

```jsonc
"symbolic": {
  "ir": "../out/ir/PAYROLL.ir.json",
  "stdinFields": ["WS-EMP-ID", "WS-HOURS-WORKED", "WS-HOURLY-RATE"],
  "baseCase": ["E00001", "38.50", "22.75"],   // boundary cases mutate this
  "moneyPattern": "PAY|TAX|GROSS|NET|...",     // optional override
  "annotations": ["WS-SPECIAL-FIELD"],         // optional explicit marks
  "maxBoundarySolutions": 5
}
```

### Failure modes — layer C specific

- **Depth limits remain**: values that pass through *two or more*
  rounded stores lose their exact form (fuzz-only, boundaries not
  pinnable); nonlinear factors whose own producers are nonlinear (e.g. a
  product of a product) fall back to the v1 heuristic or stay
  UNREALIZED. Deeper nesting needs recursive inversion — a proper SMT
  encoding — and every such case is disclosed per path.
- Loops (GO TO, PERFORM UNTIL/VARYING) need fixpoint/unrolling machinery;
  the parser rejects them upstream today.
- An obligation VERIFIED on one path may be UNREALIZED on another; the
  per-path gap is in the report and the certificate.
- Paths containing a non-affine condition cannot have a sound witness;
  their coverage is reported "unknown". Provably infeasible paths are
  reported separately and are not counted against coverage.

## Layer D — static data-flow equivalence (prototype)

`legacymind verify --layer D --config <cfg> --out <report>`

The only layer that runs **nothing**: it compares how each output is
*derived* on both sides. The modern-side extractor
(`javaflow/JavaFlow.java`, per the founding spec's "Java for the target
compiler-side tooling") parses the migrated source with the javac Tree API;
the legacy side derives the same structure from the IR.

### Why it needs no name matching

Both sides read stdin in a fixed order and print named `KEY=VALUE` lines,
so every key's derivation is expressed canonically: which **input
positions** it transitively derives from, which **multiplicative
constants**, which **rounding modes**, which **decimal shifts** (COBOL
`/ 100` ≡ Java `movePointLeft(2)`). Identifier names never enter the
comparison — candidate naming style is irrelevant.

### Config

```jsonc
"static": {
  "ir": "../out/ir/PAYROLL.ir.json",
  "modernJava": "../out/migrate/candidate-a/Payroll.java"
}
```

### Verdict rules

- Mismatched inputs / constants / rounding modes / shifts → key DIVERGENT,
  verdict FAIL. (The HALF_EVEN demo defect is caught here statically.)
- Storage-capacity differences → WARNING, not failure: a missing capacity
  wrap may be statically unreachable; layers A/B/C decide dynamically.
  Warnings flow into the certificate's gaps.
- Anything either extractor cannot analyze → key UNRESOLVED, disclosed.

### Failure modes — layer D specific

- **Flow-insensitive by design**: IF branches union, so rounding/shift
  occurrence *counts* are path-dependent and only the mode/value *sets*
  are compared. Double-rounding detection needs the planned path-sensitive
  engine.
- Truncation (setScale DOWN / plain COBOL stores) is not compared —
  frequently a numeric no-op and covered dynamically.
- The Java extractor handles the generated subset (BigDecimal arithmetic,
  helpers with locals, ternaries, if/else, StringBuilder or concat
  output). Constructs outside it surface as UNRESOLVED, never silently.
- Static equivalence complements — never replaces — the dynamic layers:
  two programs with identical derivations can still differ in evaluation
  order precision; that is exactly what B/A/C execute for.

## Layer B — differential execution

### Inputs

A JSON config (see `../examples/payroll-diff.json`):

```jsonc
{
  "legacy": { "argv": ["./payroll"], "label": "...", "env": {} },
  "modern": { "argv": ["java", "-jar", "payroll.jar"], "label": "...", "env": {} },
  "protocol": { "input": "stdin-lines", "output": "kv-lines" },
  "numericTolerance": 0.0001,   // absolute; default 0 = exact or fail
  "timeoutMs": 10000,
  "cases": [ { "id": "case-1", "stdin": ["line1", "line2"] } ]
}
```

`argv` paths resolve relative to the config file's directory. The harness is
command-agnostic: cobc binaries, jars, or mock scripts are all just argv.

### Execution contract (protocol `stdin-lines` / `kv-lines`)

Each side reads the case's stdin lines and writes one `FIELD=VALUE` pair per
stdout line, then exits 0. Non-matching stdout lines are recorded as notes in
the report, never silently dropped.

### Comparison rules

- Union of both sides' field names; a field present on only one side is a
  diff (`missing-in-legacy` / `missing-in-modern`).
- If both values parse as plain decimals, compare numerically with the
  absolute tolerance (this is what absorbs COBOL edited-picture zero padding
  vs Java `BigDecimal.toString`). Otherwise compare as trimmed strings.
- Duplicate field names: last occurrence wins, with a note in the report.

### Output

`--out report.json`: verdict, per-case status (PASS / FAIL on divergence /
ERROR on crash, nonzero exit, or timeout), every field diff with both values
and the delta, the full stdin counterexample, raw stdout/stderr for
non-passing cases, and SHA-256 hashes of the config and of both executables'
script/jar artifacts. Exit code 0 only when everything passed.

### Failure modes — read before trusting numbers

- **No sandbox yet.** Executions run directly on the host: network is NOT
  blocked, the filesystem is NOT ephemeral, and the clock is NOT injected.
  Docker sandboxing is `harness/` scope. Do not run untrusted binaries.
- **Tolerance is absolute only.** Fine for currency at fixed scale; wrong
  for quantities spanning magnitudes (relative tolerance is a planned
  config option).
- Both runs of a case execute sequentially on the host — nondeterministic
  programs (clock, RNG, concurrency) will flake until clock injection lands.
- On Windows, `argv[0]` must be a real executable (`node`, `java`, `.exe`);
  `.cmd`/`.bat` shims are rejected by Node's spawn hardening.
- A field that both sides *omit* is invisible to layer B — output-schema
  completeness is layer A/D's job, which is exactly why the layers are
  independent.
