# Inline PERFORM — hoist the body, reuse the loop

`PERFORM UNTIL … END-PERFORM` with the body written in place is the same
loop as `PERFORM <para> UNTIL …`; only the body's location differs. The
subset accepted the out-of-line form and rejected the inline one, which
blocked 11 of the analysable AWS CardDemo modules — 22 `UNTIL` and 12
`VARYING` inline loops across the corpus.

## The desugar

The inline body is hoisted into a **synthetic paragraph** and the
ordinary out-of-line PERFORM is emitted against it. Every loop shape
(`TIMES` / `UNTIL` / `VARYING`) and every verifier layer is then reused
unchanged — the same mechanism as the stage-75 mainline.

```
PERFORM UNTIL W-N > 10        MAIN-PARA.
    ADD 3 TO W-N        ==>       PERFORM 'INLINE PERFORM 1' UNTIL W-N > 10
END-PERFORM                   'INLINE PERFORM 1'.
                                  ADD 3 TO W-N
```

Implementation notes that keep it sound:

- `finishPerform` already carried the whole `TIMES`/`UNTIL`/`VARYING`
  tail; it now takes the `PerformType` directly instead of the procedure
  statement, so the inline form reuses it **verbatim** rather than
  duplicating loop semantics.
- Synthetic names (`INLINE PERFORM 1`, …) contain a space, which a COBOL
  word cannot, so they can never collide with a real procedure name and
  no source text can `PERFORM` them.
- Hoisted paragraphs are appended **after** all source paragraphs, so
  paragraph order — which decides fall-through and the control-flow
  entry — is untouched. Nothing falls into them; each is reached only by
  its own PERFORM.

## Ground truth

The desugar is only sound if it preserves behaviour, so it was checked
against the real binary rather than assumed
(`examples/probes/inline-perform.cbl` and its hand-written out-of-line
twin): an inline `UNTIL` loop plus an inline `VARYING` loop, and the same
program with both bodies moved into paragraphs, both print **`N=015`** —
the hand-predicted value.

## Result

- `inline PERFORM` blocker: **gone for all 11 modules**.
- Nearest realistic module `CBACT02C`: 5 blockers → **4**.
- Median across blocked modules 17.5 → **17.0**; VERIFIABLE still 0/31.
- Newly revealed underneath: `ELSE NEXT SENTENCE` and a
  qualified/subscripted `MOVE` target (1 module each).
- Every benchmark module's IR unchanged; `ir-core` validates the
  synthetic paragraphs.

`CBACT02C` now needs four: `CALL`, reference modification, `REDEFINES`
group-over-elementary, and signed numeric record fields.
