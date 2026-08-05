# Coverage roadmap — AWS CardDemo, measured 2026-08-05

Every number here was produced by running `assess` over the pinned corpus
(`aws-samples/aws-mainframe-modernization-carddemo` @ `59cc6c2`, 31 COBOL
programs, 47 staged copybooks), not carried forward from an earlier doc.
Regenerate with `scratchpad/unlock-rank2.mjs` against a fresh
`assessment.json`.

## Baseline

```
verifiable now:   3/31 (9.7%)  [0 four-layer, 3 reduced evidence]
blocked:          11
parse failures:   17
```

## The ceiling is 14/31, and it is structural

The 17 parse failures are **not** a parsing problem with a CICS wall
behind it — they *are* the wall. They fail on `COPY DFHAID` (×12) and
`COPY DFHBMSCA` (×5), which sum to exactly 17: every one is a BMS/CICS
screen program.

Supplying stub copybooks would make them parse. It would not make them
verifiable, because this method's ground truth is **executing the real
compiled binary**, and there is no CICS runtime under GnuCOBOL to execute
against. Layers A and B — the only two that run anything — are impossible
for these modules. What remains is layers C and D, both static, which
cannot carry a certificate on their own.

So:

| | reachable | note |
|---|---|---|
| **assessed** | 31/31 | needs stub `DFHAID`/`DFHBMSCA` only |
| **certifiable** | 14/31 | the batch subset, after all nine stages below |
| **meaningfully certifiable** | 13/31 | `COBSWAIT` is verifiable but pointless — see below |

`COBSWAIT.cbl` appears in the unlock list, but its entire purpose is
`CALL 'MVSWAIT'`, an external **assembler** wait routine. There is no
COBOL behaviour to establish equivalence *for*; the program's whole
observable effect happens inside a module we would never see. Counting it
would be padding.

## The staged route, in measured unlock order

Greedy ordering: at each step, the theme that clears the most modules
given everything already solved. **Every one of the nine is mandatory for
the full 14** — the blockers are a product, not a sum, so there is no
shortcut and no pair of stages that gets you most of the way.

| # | stage | unlocks | running total | module(s) cleared |
|---|---|---|---|---|
| 1 | VSAM keyed access + multiple input files | +1 | **4/31** | `CBTRN01C` |
| 2 | ordinary-verb tail | +1 | **5/31** | `CBTRN03C` |
| 3 | REDEFINES / byte-window V2 | +2 | **7/31** | `CBEXPORT`, `CBTRN02C` |
| 4 | record layout: signed DISPLAY, re-carving | +1 | **8/31** | `CBIMPORT` |
| 5 | inter-program `CALL` boundary | +1 | **9/31** | `CBACT04C` |
| 6 | control-flow normalisation | +2 | **11/31** | `CBSTM03B`, `COBSWAIT` |
| 7 | tables / OCCURS residue | +1 | **12/31** | `CSUTLDTC` |
| 8 | COPY span provenance on real expansion | +1 | **13/31** | `CBACT01C` |
| 9 | `USAGE POINTER` | +1 | **14/31** | `CBSTM03A` |

### What each stage actually contains

1. **VSAM keyed + multi-file** — `ACCESS MODE RANDOM`, `READ ... KEY` /
   `INVALID KEY`, `REWRITE`, `OPEN I-O`, `OPEN OUTPUT` of an indexed
   file, and lifting "file I/O stage 2a supports exactly one input file"
   (two modules read 2 and 5 input files). The `OPEN/CLOSE/READ of "…"
   which is not a lowered file` and `FD … without a matching lowered
   SELECT` blockers are *downstream consequences* of the SELECT not
   lowering, so a large cascade clears with the root cause.
2. **Ordinary-verb tail** — `INITIALIZE`, `STRING`, `FUNCTION
   CURRENT-DATE`, `ELSE NEXT SENTENCE`, `EVALUATE TRUE WHEN VALUE`,
   qualified/subscripted `MOVE` targets. Individually trivial,
   collectively present in 9 of 11 blocked modules.
3. **REDEFINES / byte-window V2** — the existing byte window covers a
   group view over an **elementary binary** target; real code also views
   over `USAGE DISPLAY` targets.
4. **Record layout** — signed `DISPLAY` fields (`S` overpunches the sign
   into the last byte; stage 2b assumes unsigned), and `READ ... INTO` a
   target narrower than the record (240 into 300, 39 into 50). Financial
   records carry signed amounts everywhere, so this generalises well
   beyond CardDemo.
5. **Inter-program `CALL`** — `CALL`, `LINKAGE SECTION`, `PROCEDURE
   DIVISION USING/GIVING`. Genuine architecture: nothing in the pipeline
   models a call boundary today.
6. **Control-flow normalisation** — backward and non-tail `GO TO`,
   `GO TO …-EXIT` inside PERFORM-reachable paragraphs, `ALTER`,
   `EXIT PROGRAM`, backward `PERFORM THRU` ranges, statements before the
   first paragraph header.
7. **Tables / OCCURS** — `OCCURS` groups whose leaf is itself a group or
   non-DISPLAY, and subscripted `MOVE` targets that are not lowered
   tables.
8. **COPY span provenance** — `REPLACING`, adjacent and nested COPY. The
   sequence-alignment fallback handles the benchmark, not real expansion.
9. **`USAGE POINTER`** — one module, and worth asking whether a pointer
   is verifiable at all before building it.

## What this does NOT change

Unlocking a module makes it **eligible**, not certified. Each one still
needs a harness image, a `migrate` run that survives the verifier, and
whatever layer declines get disclosed. And layer C currently declines
every file-reading module on `READ after AT END` (an unmodelled FILE
STATUS — `docs/layer-c-declines.md`), so without that stage the whole
column stays `[0 four-layer]` no matter how far the count climbs.

**Fixing FILE STATUS symbolically adds no modules but changes the quality
of every one of them.** It is the only item here that moves
reduced-evidence to four-layer.

## Corrections to earlier planning

- **`USAGE COMP` blocks zero CardDemo modules.** The 2026-08-01 figure of
  13 came from CardDemo **+ DSF/OMP combined**, and the 149 figure is
  NIST. Any plan that ranked COMP first for CardDemo was reading the
  wrong table.
- The 2026-08-01 "median 26 blockers" is stale; the 11 remaining blocked
  modules now need between **1 and 7 themes** each, and one of them
  (`CBTRN01C`) needs exactly one.
