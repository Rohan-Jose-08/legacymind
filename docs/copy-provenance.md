# COPY span provenance — align on code, not on text

Stage 61 added a COPY-aware line alignment so that programs using
copybooks could be verified at all: the preprocessor's output has more
lines than the source, and the frontend refuses to emit IR whose spans it
cannot map back to original lines. On real code that refusal fired on
**11 of the 14 analysable AWS CardDemo modules** — a defect in our
tooling, not a missing capability, and it blocked the nearest real module.

## Diagnosis

The alignment compared line text. The preprocessor **rewrites more than
it inserts**, and each rewrite was found only by looking at its actual
output:

| what | original | preprocessed |
|---|---|---|
| fixed-format comment | `      *****…` | `      *> ****…` |
| comment *entry* | `AUTHOR.        AWS.` | `AUTHOR. *>CE   AWS.` |
| first line | — | carries a **BOM** |
| blank/comment runs | — | re-flowed |

`CBACT02C` uses a single `COPY`, no `REPLACING`, and a 14-line copybook —
the simplest possible case — and still failed, at line 1, on the comment
rewrite. Patching each rewrite in turn just surfaced the next one.

## The fix

Span provenance only ever needs to map lines that carry **statements**.
So comments and blanks are dropped from *both* sequences and the
remaining code lines are matched on whitespace-collapsed content with
preprocessor markers (`*>…`) removed. Comments may then be rewritten,
re-flowed or re-marked freely without breaking the mapping; preprocessed
comment/blank lines map to the last mapped original line, where no
statement can live.

The honest refusal is unchanged: an unexplained divergence between two
**code** lines still returns null and rejects the module. This widens
what can be explained; it does not weaken the check.

## Result

Modules blocked by span provenance on CardDemo: **11 → 2**. The nearest
realistic module (`CBACT02C`) went from 7 blockers to **6**, and the
median across blocked modules from 18.0 to 17.5.

Every benchmark module's IR — spans included — is unchanged, verified by
re-parsing and diffing before running the suite.

## The two that remain, and why

- **`CBACT01C` — adjacent `COPY` statements.** Two COPYs on consecutive
  lines. When copied content does not match the next original code line,
  the algorithm cannot tell where the first copybook's expansion ends and
  the second begins without reading the copybooks and counting their code
  lines. Named as a limitation in stage 61; still open.
- **`CBSTM03A` — continuation lines (11 of them).** The preprocessor
  *joins* a continued statement into one line, so the joined text matches
  no single physical original line. Fixing this means joining original
  continuations before keying them.

Both are tractable and both are real; neither is guessed at. They are
counted, not hidden — a module we cannot map is still refused.
