# transpiler/ — LLM-driven modernization

## Purpose

Turns one IR module into idiomatic Java 21 behind a driver-agnostic
`ModelClient`, with every call cached, hashed, and replayable, and with the
**verifier — not the model — selecting what ships**. Implementation currently
lives in `../cli/src/transpile/` and `../cli/src/model/` (single buildable
package for the MVP); this directory holds the design doc, the replay cache,
and the recorded response payloads.

## Architecture

1. **Prompt building** (`cli/src/transpile/transpile.ts`) — deterministic:
   the module IR minus its `provenance` block (timestamps must not change
   cache keys), a fixed system prompt, and a per-candidate variant
   instruction.
2. **ModelClient + replay cache** (`cli/src/model/`) — cache key =
   SHA-256 of (model, maxTokens, system, prompt). Cache hit → replay, zero
   cost, works air-gapped. Miss → live call through the official Anthropic
   SDK (default model `claude-opus-4-8`, adaptive thinking) and the response
   is recorded. Miss with `--offline` or no credentials → a `<key>.request.json`
   stub is written and the run fails loudly with the exact key.
   Token usage and USD cost are metered per call (cost table in
   `cli/src/model/client.ts`).
3. **Two candidates per module.** The founding spec called for
   temperature-diverse candidates; current Claude models (Opus 4.7+) removed
   sampling parameters from the API entirely, so candidates are
   **prompt-variant-diverse** instead: `a` (faithful — exact COBOL behavior
   first) and `b` (idiomatic — modern Java conventions first).
4. **Compile + select.** Each candidate is compiled with `javac --release 21`
   (compile failure = rejected, compiler output preserved), then run through
   verifier layer B on the `--diff-config` cases. The first candidate with a
   PASS verdict wins; no passing candidate means no winner and exit 1.
   `selection.json` records everything: cache keys, cost, compile results,
   per-candidate verdicts, winner.

## Why the system prompt does not spell out ROUNDED = HALF_UP

Deliberate. Encoding every legacy semantic into prompt text is the fragile
approach LegacyMind exists to replace — a prompt can never enumerate all of
COBOL's arithmetic behavior, and a model can ignore it anyway. The verifier
is the guarantee. The bundled demo makes the point: candidate B compiles,
looks reasonable, and silently uses HALF_EVEN (banker's rounding — the
reflexive Java default) where COBOL ROUNDED is half-up. Layer B catches it
on a half-cent case and layer A rediscovers it from generated inputs alone.

## The recorded cache (`cache/`, `recorded/`)

`cache/` ships pre-recorded responses so the demo runs offline/air-gapped.
`recorded/` holds the readable payloads. Provenance of the shipped entries:
recorded from a claude-fable-5 interactive dev session via
`cli/scripts/record-response.mjs`; **candidate B deliberately preserves the
representative HALF_EVEN defect** so the offline demo exercises the full
catch-and-select loop. With live credentials (`ANTHROPIC_API_KEY` or an
`ant auth login` profile) and a cold cache, `migrate` generates and records
fresh candidates instead.

Recording workflow:

```
legacymind migrate <ir> --diff-config <cfg> --out <dir> --offline   # miss -> <key>.request.json
node cli/scripts/record-response.mjs transpiler/cache <key-prefix> <response.java> [note]
legacymind migrate ...                                              # replays
```

## Failure modes

- **Cache miss without credentials** → loud error naming the key and the
  request stub. Never silently skipped.
- **Compile failure** → candidate rejected; javac output stored in
  `selection.json`.
- **No candidate passes verification** → `winner: null`, exit 1. The module
  is not migrated, and the report says so.
- **Model refusals / truncation** → surfaced as errors (`stop_reason` is
  checked; anything other than `end_turn` fails the call).
- **Changing model, prompt text, or maxTokens changes every cache key** —
  by design; a shipped cache is pinned to exact requests.

## Planned (per the founding spec)

Spring Boot 3.x scaffolding for service-shaped modules (batch stdin/stdout
programs like PAYROLL get plain Java — a framework would change observable
behavior); copybook-aware chunking for large programs; per-module model
routing by cost/quality; candidate count > 2.
