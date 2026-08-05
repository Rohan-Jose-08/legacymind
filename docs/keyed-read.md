# Keyed RANDOM reads — ground truth before the engine work

*Stage 90, 2026-08-05. Probe: `examples/probes/keyed-read.cbl` +
`keyed-read-loader.cbl` + `Dockerfile.keyed-read`.*

`CBTRN01C` is the only CardDemo module one stage away from verifiable
(`docs/coverage-roadmap.md`), and it needs two things the pipeline has
never done: **more than one file open at once**, and **`ACCESS MODE
RANDOM` with `READ ... KEY IS ... INVALID KEY / NOT INVALID KEY`**.

Predictions were written into the probe source before the first run. All
six held.

| | prediction | measured |
|---|---|---|
| P1 | keyed read, key present → `00`, `NOT INVALID KEY` | ✅ `HIT-STATUS=00`, `HIT-BRANCH=VALID` |
| P2 | keyed read, key absent → `23`, `INVALID KEY` | ✅ `MISS-STATUS=23`, `MISS-BRANCH=INVALID` |
| P3 | **on a miss the `INTO` target is left unchanged** | ✅ still held the previous record |
| P4 | three INDEXED files open simultaneously | ✅ |
| P5 | existing but EMPTY indexed file opens `00`, keyed read → `23` | ✅ |
| P6 | a short key is space-padded before lookup | ✅ `4111` → `23`, not a prefix hit |

P6 is confirmed in the operative sense — the padded key was used, so no
prefix match occurred — rather than by testing two spellings of the same
padded key.

## P3 is the finding

**On `INVALID KEY`, the `READ ... INTO` target retains its previous
contents.** Nothing is cleared, nothing is partially copied:

```
HIT-INTO =[4111111111111111XREF-DATA-FOR-4111................]
MISS-INTO=[4111111111111111XREF-DATA-FOR-4111................]   <- unchanged
```

This is a defect class waiting for a migration. The natural Java shape for
a keyed lookup is `Optional<Record> r = index.get(key)` followed by
clearing or reassigning the target — and any implementation that blanks
the record area on a miss diverges the moment the program touches that
area afterwards. `CBTRN01C` has exactly the vulnerable shape: it reads
`XREF-FILE`, and on success uses fields *from the record it just read* to
key the next lookup into `ACCOUNT-FILE`. It is the same family as finding
10 (a commented-out `DISPLAY`) and finding 12 (ignored index ordering):
the Java looks entirely reasonable and only the file semantics disagree.

Layer B catches it only if the program displays the stale area on a miss
path, so the curated cases for this module must include **a miss followed
by a use**, not just a miss.

## Other engine-relevant facts

- The miss status is **`23`**, not `35` (file not found) or `10` (end of
  file). A verifier that lumps all non-`00` statuses together would lose
  the distinction that drives the program's branch.
- **An empty indexed file is a normal, openable file.** `OPEN INPUT`
  returns `00` and a keyed read returns `23`. This matters because
  `CBTRN01C` opens six files and reads only three — the other three must
  exist, and the harness must create them empty rather than skip them.
- Three indexed files coexist in one run with no interference.

## What the harness needs

The existing loaders materialise exactly one indexed file from
`seed.txt`. `CBTRN01C` needs six files built in one run, three of them
empty. The probe loader demonstrates the shape that works: a **multiplexed
seed**, one record per line, prefixed with a single-character file tag.

```
X|4111111111111111<34 bytes of XREF data>
A|00000000011<39 bytes of ACCOUNT data>
```

Untagged files are still created (`OPEN OUTPUT` then `CLOSE` with no
`WRITE`), which is what produces a valid empty indexed file.

The modern side receives the same multiplexed seed and has to build its
own keyed lookup from it — exactly what a real VSAM migration must do,
and the same contract the single-file VSAM harness already uses
(`docs/vsam.md`).

## Not yet done

This stage established ground truth only. The frontend still rejects
`ACCESS MODE RANDOM`, keyed `READ`, and more than one input file; none of
that is lowered yet, and `CBTRN01C` remains BLOCKED.
