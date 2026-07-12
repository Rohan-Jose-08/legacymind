# REDEFINES, part two — edited views, group views, and a contaminated head

Design stage for the second REDEFINES front: the numeric-**edited** and
**group** redefining views that make up the corpus's #1 rejection head.
Stage R1a (elementary numeric-over-numeric, read-only) is live in the DUES
module; `docs/redefines.md` designed R1b (cross-category `X`↔`9`) and R2
(write-through) for elementary scalars. This document covers the shapes
that actually dominate the head — and its headline finding is that the
head is not what the raw count says it is.

Every claim below is validated against real artifacts: GnuCOBOL 3.1.2 was
probed through `examples/probes/redefines-edited.cbl` (built and run under
the legacy image's `cobc`), the ProLeap API surface was confirmed by a
live frontend run on that probe, and the corpus numbers come from a fresh
sweep of the pinned checkout (`uwol/proleap-cobol-parser @ d1bfe75bdd`).

## The head, re-measured (and the sub-shape split R1a deferred)

The R1a design left a debt: "the sub-shape split is deferred to the next
sweep." This is that sweep. The frontend's REDEFINES rejection was
enriched to name the *view* shape (`ProLeapFrontend.redefineShape`), so
the single 4,277 lump now splits:

| Redefining-view shape | Rejections | Share |
| --- | ---: | ---: |
| numeric-edited (`-9(9).9(9)`, `ZZ,ZZ9.99`, `$$$,$$9.99`, …) | 3,218 | 75% |
| group (children partition the shared bytes) | 961 | 22% |
| signed numeric (`S9(n)`, overpunch) | 52 | 1% |
| alphanumeric (`X(n)`) | 42 | 1% |
| targets / untyped / written | 24 | <1% |

So the head is three-quarters edited views. But the far more important
measurement is *where those views live*.

## The contamination finding — the #1 head is 93% test scaffold

Counting REDEFINES **lines** in the corpus (4,450 of them) and grouping by
their target:

| REDEFINES target | Lines |
| --- | ---: |
| `COMPUTED-A` / `CORRECT-A` (NIST CCVS scaffold) | 3,856 |
| `CORRECTMI-A` / `CORRECTMA-A` (CCVS min/max variants) | 270 |
| everything else (the real tail) | ~324 |

`COMPUTED-A` is the NIST **CCVS** (COBOL Compiler Validation System)
self-checking harness. Every one of the 459 NIST test files declares the
same block: a 20-byte `PIC X(20) VALUE SPACE` answer field redefined by
~10 views — `COMPUTED-N PIC -9(9).9(9)`, `COMPUTED-0V18 PIC -.9(18)`,
`COMPUTED-4V14`, `COMPUTED-14V4`, a `CM-18V0` group view — and the same
again for the expected answer `CORRECT-A`. The harness computes a value,
`MOVE`s it into whichever edited view matches its scale (formatting it into
the 20 bytes), then string-compares `COMPUTED-A` against `CORRECT-A` and
prints PASS/FAIL.

**~93% of the entire REDEFINES head is this one boilerplate block repeated
across 459 files.** It is not 4,000+ distinct business idioms; it is a
compiler-conformance test scaffold. The genuine, business-shaped tail —
`WRK-DS-09V09` (19), `WRK-XN-18-1` (16), `WB-FILL` (16), `P190-TEXT` (12),
and a long thin tail — is on the order of a few hundred lines, and even
those are largely NIST *working-storage* probe fields, not application
logic.

This is the "no hidden failures" discipline turned on our own backlog
metric. The corpus histogram is a real signal, but for REDEFINES it is
inflated ~14× by the CCVS harness. Prioritizing "the #1 head" at face
value would mean building an edited-picture engine to satisfy a test
artifact. The sweep should carry this caveat (and ideally a
scaffold-de-duplicated count) so the backlog metric stops overstating this
head. **This finding is the primary deliverable of the stage** — it
changes what is worth building next more than any lowering rule would.

## Validated ground truth (GnuCOBOL 3.1.2)

Probe `examples/probes/redefines-edited.cbl`. All outputs are byte-exact
from the real binary; brackets delimit each field so width and content are
unambiguous.

**Editing applies on the MOVE *into* an edited item, never on read.**
This is the semantic that decides everything:

- **A — widths and rules.** `-9(9).9(9)` occupies **20 bytes**: one sign
  position (space for `+`, `-` for `−`), nine integer digits (a `9`
  forces a digit, so no suppression: `123` → `000000123`), a literal `.`,
  nine fraction digits. `MOVE 123.45` → `[ 000000123.450000000]`;
  `MOVE -7.5` → `[-000000007.500000000]`. `ZZ,ZZ9.99` (9 bytes):
  `12345.67` → `[12,345.67]` (zero-suppression + comma insertion).
  `$$$,$$9.99` (10 bytes): `42.50` → `[    $42.50]`, `0` → `[     $0.00]`
  (floating `$`). `9(5).99CR`: `−88.25` → `[00088.25CR]`, `+88.25` →
  `[00088.25  ]`.
- **B — edited target, read the formatted bytes through an X view.**
  `01 T PIC -9(9).9(9)` with `01 TX REDEFINES T PIC X(20)`. After
  `MOVE 123.45 TO T`, both `T` and `TX` read `[ 000000123.450000000]` —
  **byte-identical**, for positive, negative, and zero. Writing the
  numeric value into the edited item and reading the raw bytes back is
  total and well-defined. This is the useful idiom.
- **C — a read-only edited *view* exposes raw base bytes, unformatted.**
  `01 B1 PIC 9(4)V99 VALUE 0150.25` (bytes `015025`) with
  `01 BV REDEFINES B1 PIC ZZ9.99`. Reading `BV` **without** moving into it
  yields `[015025]` — the raw base bytes, **not** `0150.25` formatted.
  Editing did not fire, because nothing was moved *into* the edited view.
- **D — group over group is byte reinterpretation.** A `9(3)|9(4)V99`
  group holding `123` and `4567.89` is `123456789`; a `9(4)|9(5)`
  redefining group reads `G2A=[1234] G2B=[56789]`. Nothing more than a
  re-slice of the shared bytes.
- **E — de-editing works.** `MOVE` of an edited item to a numeric
  (`S9(9)V9(9)`) recovers the value: `[-000000123.450000000]`.

The soundness boundary is the one 2b and R1a already drew: a numeric
decode of bytes that are not all digits is undefined (DISPLAY and
arithmetic disagree, nothing errors). Edited output bytes contain
insertion characters (`.`, `,`, `$`, spaces, `CR`), so decoding an edited
field's bytes *as a number* is outside the envelope by construction.

## ProLeap exposure

Confirmed on the probe by a live frontend run:

- The picture category is exposed and classified correctly — the
  enriched rejection named `TX` alphanumeric, `BV` numeric-edited, `G2` a
  group, exactly as the corpus sweep did at scale.
- Group views lower structurally: the redefining group arrives with its
  children through the existing `lowerDataItem` path, and its target
  resolves through the same `resolveQualified`/`getRedefinesCall`
  machinery R1a already uses.
- **The picture parser only accepts the edit symbols `{Z B 0 . , * + $ -}`
  (`Picture.NON_PICTURE`).** `9(5).99CR` fails earlier, as
  `PICTURE …: unsupported symbol`, and never reaches the REDEFINES gate —
  so `CR`/`DB`/`/` edited fields are counted in a *different* bucket, and
  the true edit surface (credit/debit, slash and blank insertion, check
  protection `*`, `P` scaling) is larger than even the 3,218 shows.

## Two idioms, two guarantee classes

The head splits cleanly into two constructs whose verification stories are
fundamentally different.

### Edited views (RE) — display-formatting equivalence, execution-carried

The real edited idiom (probe case B, and the CCVS harness) is: `MOVE` a
numeric value into an edited item, then read/compare the formatted bytes.
Verifying a Java translation of this means the candidate must reproduce
COBOL's edit rules — sign position, zero suppression, floating currency,
insertion characters, `CR`/`DB` — **byte-for-byte**. That is a
string-formatting obligation, and it does **not** live in the Layer C
symbolic solver: the formatted field is not a numeric quantity the program
branches on; it is an output string. Layer C keeps verifying the
*arithmetic that produces the pre-edit value* exactly as today; the edit
itself is established by **differential execution** — Layers A (seeded
property cases spanning sign/zero/suppression boundaries) and B (byte-exact
diff-exec) against the real GnuCOBOL binary.

This is consistent with how the engine already treats non-numeric data
(alphanumeric leaves are "skipped by every solver … conditions over them
fall to the fuzz belts and layers A/B"). But it is honestly a **weaker
guarantee class** than the arithmetic proofs that differentiate the
product — bounded execution over a seeded domain, not a symbolic proof —
and it requires a large new frontend surface (an edit-picture parser
extension plus a Java edit formatter). Given the contamination finding, it
is a large investment for a count that does not represent real demand.

### Group views (RG) — byte re-slice, Layer-C-provable

A group view over a group (or scalar) of **well-formed** numeric/`X`
leaves is exactly the 2b record model applied to shared storage: two
`LayoutSlot` layouts over one byte range. Reading view leaf *j* means
decoding the shared bytes `[offset_j, offset_j+width_j)` through leaf *j*'s
picture — the same canonical `decode` R1a and 2b already use. When only
the base is written and the view is read-only, there is no aliasing
*update*, only an aliasing *read* that is a pure function of the base
bytes. This keeps the proof-grade Layer C guarantee the product sells,
and reuses machinery that already exists.

## Sound subsets and rejection rules

**RG-sound (recommended build):** a read-only group view where
- both the target and the view contain only elementary **unsigned numeric
  DISPLAY** or `X(n)` / FILLER leaves (the 2b/R1a well-formed set);
- the view is never a write target (no aliasing update);
- view leaf boundaries **coincide with** target leaf boundaries
  (whole-leaf regrouping) — so each view leaf is a concatenation or
  decomposition of whole target leaves, provable as a composition of the
  R1a decimal shifts, with no mid-byte split arithmetic;
- no OCCURS on either side; no nested edited/signed/COMP leaf; no `P`.

Rejected loudly, each with its reason: a written view (aliasing update →
future RG-write stage); mid-leaf byte splits (a view leaf straddling a
target leaf boundary → needs byte-level encode/slice/decode in Layer C, a
named follow-on); any edited/signed/COMP/OCCURS leaf; a group view over a
formatted or space-filled base (the CCVS shape — its bytes are not
well-formed digits, so a numeric re-slice is undefined).

**RE-sound (designed, not recommended now):** if a design partner's real
report code forces it — `MOVE numeric TO edited`; the edited item (or an
`X` redefine of it, or the base it overlays) is only read/displayed/
string-compared afterward, never de-edited back into arithmetic; the edit
picture is within an implemented formatter subset. Verified byte-exact by
Layers A/B; Layer C unchanged. Rejected: de-editing an edited value into a
branch or computation; `CR`/`DB`/`/`/`*`/`P` until the picture parser and
formatter cover them; an edited *view* read without a prior move into it
(probe case C — raw bytes, no defined numeric meaning).

## IR and layer plan (RG, the recommended build)

The IR needs no new statement kinds. A group view carries `redefines`
(resolved target) and its leaves share the target's `offset`; the cursor
does not advance — identical overlap to R1a, but the shared range now
holds a `LayoutSlot` **list** rather than one slot. The frontend computes
the overlay; Layer C recomputes from the DataItem tree and asserts
equality (drift = build error), exactly as 2b does for records.

- **Layer B** — no change; bytes are bytes.
- **Layer A** — no change for the read-only subset; generation feeds the
  base leaves (the writers), as with any record.
- **Layer C** — a read of view leaf *j* resolves to the decode of the
  shared bytes over its range. For the boundary-aligned subset this is a
  composition of R1a shifts over whole target leaves: no new solver
  surface, just leaf bookkeeping over the shared layout. (Mid-leaf splits,
  deferred, would need the 2b encode/slice/decode lifted to symbolic
  bytes.)
- **Layer D** — the view and target share storage, so a view-leaf
  reference derives from whatever derives into the target leaves covering
  its range — the same shared-storage flow R1a and 2b established.
- **Certificates** — the envelope names the well-formed-leaf contract and
  the read-only, boundary-aligned restriction.

Minimal stage-44 module: a WORKING-STORAGE group written field-by-field
(e.g. `9(3)` id + `9(4)V99` amount), redefined by a different but
boundary-aligned group (e.g. `9(3)` + `9(6)` reading the amount at a
shifted scale), read for a money computation with a `ROUNDED` boundary so
Layer C carries a real obligation. Candidate B carries a realistic re-slice
defect — reading the view at the wrong leaf offset — which Layers B and D
both catch (a value divergence and a mismatched flow).

## Recommendation

1. **Land the contamination finding first**, independent of any build: it
   is a genuine "no hidden failures" result about our own metric and a
   strong pitch artifact ("we measured our own backlog honestly and found
   the top line was 93% test scaffold"). Add it to the findings log and
   caveat the sweep's REDEFINES count.
2. **If a REDEFINES module is the next build, build RG** (read-only,
   well-formed-leaf, boundary-aligned group views) — the only proof-grade,
   thesis-consistent slice of the head. Modest in true multiplicity, but a
   clean, honest Layer-C win.
3. **Do not build the edited-picture engine to chase the count.** It is
   execution-carried (a weaker guarantee class), large in surface, and the
   count that motivates it is a NIST artifact. Build it only when a design
   partner's real report code demands formatting equivalence — at which
   point RE-sound above is the plan.
4. **Weigh building outside REDEFINES entirely.** Because the head is
   contaminated, the highest proof-grade marginal value for the differentiator
   may be solver depth (lower-bound-through-a-rounding, multi-var composed
   forms) rather than any REDEFINES lowering. This is the honest read of the
   data and belongs in the next-stage decision.

## Risks and decided trade-offs

- **The motivating count is contaminated** — surfaced, quantified, and
  made the headline rather than buried. The decision to *not* chase it is
  the point.
- **Edited formatting is a weaker guarantee class** — execution-carried,
  disclosed as such; not folded silently into the proof story.
- **Aliasing stays quarantined** — RG writes only the base; the view is
  read-only, so there is no aliasing update, exactly as R1a.
- **Well-formed bytes only** — inherited verbatim; a numeric re-slice of
  formatted/space bytes (the CCVS shape) is excluded, not approximated.
- **Mid-leaf splits deferred** — named, not silently dropped; they need
  symbolic byte-level encode/slice/decode and are a follow-on stage.
