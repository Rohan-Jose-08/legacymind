# Byte windows — reference modification and REDEFINES over an elementary

Design for the two blockers that, with the stage-2a `READ`-loop shape,
are all that stand between us and the first certified third-party
modules: **reference modification** `X(a:b)` and **`REDEFINES` of a group
over an elementary target**.

This is a design stage. The corpus is measured, the semantics are
validated against the pinned container, an attractive shortcut is tested
and **killed**, and the sound subset is scoped. **No engine code**, and
the reason is in "Why this stops here".

## They are one feature

Both put a **byte window** over storage that is already declared as
something else:

```cobol
MOVE IO-STAT1 TO IO-STATUS-04(1:1)     *> window: bytes 1..1 of a group

01  TWO-BYTES-BINARY   PIC 9(4) BINARY.      *> 2 bytes of binary
01  TWO-BYTES-ALPHA    REDEFINES TWO-BYTES-BINARY.
    05  TWO-BYTES-LEFT  PIC X.               *> window: byte 1
    05  TWO-BYTES-RIGHT PIC X.               *> window: byte 2
```

One primitive — *address a byte range of an existing item and read or
write it under a different type* — with two syntaxes. Building it once
serves both, and neither can be built without it.

## The corpus, measured

Reference modification in AWS CardDemo (`app/cbl`, comment lines
excluded by indicator-column filtering):

| sites | shape |
|---|---|
| **118** | literal offset, literal length — `X(1:4)` |
| 44 | literal offset, **variable** length — `X(1:WS-LEN)` |
| 2 | **variable** offset, literal length |

`REDEFINES` in the 11 modules the blocker names:

| count | shape |
|---|---|
| **8** | `01 TWO-BYTES-ALPHA REDEFINES TWO-BYTES-BINARY` — *character-identical in all eight* |
| 3 | `CSUTLDTC` severity/message-number numeric-over-alphanumeric |
| 2 | `FILLER REDEFINES DB2-FORMAT-TS` |
| — | `CBEXPORT`, `CBIMPORT` declare none in source: theirs arrive through `COPY` (`CVEXPORT` and friends), which is why the blocker names 11 modules while only 8 sources mention the shape |

So a V1 of **literal offset, literal length** plus **a 2-byte group over
a 2-byte binary** covers 72% of refmod sites and the exact shape eight
real modules share verbatim. The three target modules (`CBACT02C`, `CBACT03C`,
`CBCUS01C`) use nothing else.

## Ground truth (GnuCOBOL 3.1.2, pinned container)

Six predictions written before running; all held. Probes:
`examples/probes/bytewindow-*.cbl`.

| observation | measured |
|---|---|
| `PIC 9(4) BINARY` storage | **2 bytes**, so the 2-byte group covers it exactly |
| byte order | **big-endian** — `TWO-BYTES-RIGHT` is the low-order byte |
| `MOVE '9' TO TWO-BYTES-RIGHT`, read the binary | **57** — the ASCII code |
| `MOVE '9' TO TWO-BYTES-LEFT`, read the binary | **4592**, not 14592 — the read applies **decimal truncation mod 10⁴** |
| `MOVE 'X' TO GRP(1:1)` on `ABCD` | `XBCD` — exactly that byte, rest untouched |
| `MOVE 'YZ' TO GRP(3:2)` on `ABCD` | `ABYZ` — spans part of a child, and does not disturb the rest |

The truncation row is reassuring: it is the same binary-COMP truncation
already measured and disclosed in `docs/binary-comp.md`, not a new rule.

### The whole CardDemo idiom, pinned

`9910-DISPLAY-IO-STATUS`, verbatim, against the real binary:

| file status in | prints |
|---|---|
| `00`, `10`, `23` | `0000`, `0010`, `0023` |
| `9A` | `9065` |
| `99` | `9057` |
| `0Z` | `0090` |
| `9` + space | `9032` |
| two spaces | `` ` 032` `` — **a space in a `PIC 9` field** |

## The shortcut, and why it is dead

The attractive cheap path was to **desugar** the window into arithmetic
on character codes, so every existing layer would work unchanged and no
aliasing model would be needed — the playbook that carried inline
`PERFORM`, `GO TO` elimination and O3-flat. Written and run against the
real binary, it disagrees on **7 of 10** inputs:

| in | aliased (truth) | desugared | |
|---|---|---|---|
| `23` | `0023` | `0023` | ok |
| `9A` | **9**065 | **7**065 | wrong |
| `0Z` | **0**090 | **8**090 | wrong |

The error is entirely in the first digit, and it is the whole lesson:
`MOVE IO-STAT1 TO IO-STATUS-04(1:1)` stores the **character** `'9'` into
byte 1. `IO-STATUS-0401` is `PIC 9` DISPLAY, where the digit character
*is* the storage — so it reads back as 9. The desugar computed
`ORD('9') - 1 = 57`, then `57 mod 10 = 7`. Both are "the byte", but a
DISPLAY numeric interprets its byte as a **character**, while the
`REDEFINES` over `BINARY` interprets its byte as a **number**.

So the two windows in the same paragraph need *opposite* readings of a
byte, and no single arithmetic desugaring covers both. Byte-addressable
storage has to be modelled, not encoded away.

### The soundness trap underneath it

The two-space case prints `` ` 032` ``: a **space sitting in a `PIC 9`
field**. A byte window lets the program write storage that its own
PICTURE says is impossible, and real code does it on an ordinary error
path.

Every numeric invariant the verifier currently relies on for DISPLAY
fields — that they hold digits, that they decode as numbers, that layer
C can treat them as integers — is **false** for any field a byte window
can reach. This is the actual engine problem, and it is why
`docs/memory-layout.md` deferred aliased storage to its own stage: it is
not "add an offset", it is "some storage is no longer typed".

## The sound V1 subset

**W1 — literal byte windows over byte-modelled storage.** An item is
**byte-modelled** if any byte window can reach it. Byte-modelled storage
holds bytes, not values; reads through a PICTURE decode those bytes
(DISPLAY numeric = characters, `BINARY` = big-endian with decimal
truncation), and a decode that cannot succeed is a **loud refusal**, not
a guess. Windows must have literal offset and literal length, must lie
wholly inside the target, and the `REDEFINES` view must exactly cover
its target.

**Enumerated residuals (rejected loudly):**

- variable offset or variable length (46 of 164 real sites) — the window
  is not statically known, so neither is the layout
- a window over `COMP-3`, or spanning a sign byte
- a `REDEFINES` view narrower or wider than its target
- windows into a table occurrence, or into a file record buffer
- anything that would make a byte-modelled field an operand of arithmetic
  without an intervening decode

## Built (W1, stage 80)

Shipped as scoped above, with one decision the design left open: **byte
windows are executed, not reasoned about.**

| layer | treatment |
|---|---|
| A, B | **execute both sides** — they need no model at all, which is why the feature is deliverable now |
| C | byte-modelled items are **opaque**; paths over them claim nothing (stage 84 — it used to refuse the whole module) |
| D | **discloses**: a window-written field is `UNRESOLVED`, never a claimed derivation |

Layer C's first cut refused the whole module, on the grounds that a
byte-modelled field read as a number would be a confident *wrong* claim
and no numeric domain can hold the space a window can leave inside a
`PIC 9`. Both remain true — but refusing everything was heavier than the
soundness argument requires. **Stage 84** starts those items **opaque**
instead: opaque is already first-class here, so conditions over them do
not parse as affine and their paths fork honestly and claim nothing,
while the rest of the module verifies normally. A symbolic byte domain,
which would let layer C reason about them rather than decline, is still
a stage of its own.

What lands in the IR:

- each `REDEFINES` view leaf carries `window: {of, offset, length}`
  (offset 1-based, as COBOL counts);
- reference modification lowers to a **new statement kind**,
  `move-window`, so no existing module's IR changes and the transpiler
  replay cache does not re-key;
- every item a window can reach — the whole subtree, since a group's
  bytes *are* its children's storage — is marked `byteModelled`.

`ir-core` re-checks the window bounds, because the IR is what the
certificate is signed over.

The frontend also checks that a window lies **wholly inside** its target,
which needs a storage width for every item — a group is the sum of its
children, an elementary item depends on `USAGE`, and a width that cannot
be computed is a refusal rather than an assumption. `G4(4:2)` over a
4-byte group is rejected by name; `G4(3:2)` is accepted. Out of bounds is
not a smaller claim, it is a different program: the bytes past the end
belong to whatever the compiler laid out next.

**Verified** on `examples/statusfmt.cbl`, the CardDemo
`9910-DISPLAY-IO-STATUS` idiom: layer **A 200/200**, layer **B 9/9**
(including the two-space case that puts a space inside a `PIC 9`), layer
**C refused by name**, layer **D PASS with the window derivation
disclosed as unresolved**.

**Effect on real code:** `CBACT02C`, `CBACT03C` and `CBCUS01C` drop from
3 blockers to **1** — the stage-2a `READ`-loop shape is all that is left.
CardDemo's median falls 16.5 → 15.5.

## Why the design stopped where it did

The stage is scoped, measured and de-risked, and it deliberately ships no
engine code, because the measurement changed what the work is:

1. The desugaring shortcut is **dead** — proven, not suspected. The
   cheap path that would have reused every layer does not exist.
2. What remains is **typed storage becoming untyped** for any field a
   window can reach. That touches the IR, `ir-core`, layer C's symbolic
   state, layer D's flows, and layer A's generator — each needing its
   own soundness argument.
3. There is **no smaller increment that moves the number.** A
   read-only-window subset, or an alphanumeric-only subset, unlocks
   none of the three target modules: both of their windows write, and
   one writes into a group with numeric children.

Recommendation: take W1 as the next stage's scope, and expect it to be
the largest single engine change since the file model — not because the
COBOL is exotic, but because it removes an invariant three layers
currently assume.

**Outcome (stage 80).** Point 3 held and points 1 and 2 held, but the
size estimate did not: W1 turned out **smaller** than "the largest
change since the file model", because the estimate assumed all four
layers needed a byte model. They do not — layers A and B execute both
sides and never inspect storage, so only C and D had to change, and both
changed by *declining to claim* rather than by modelling bytes. The
expensive part — a symbolic byte domain — is still unbuilt and is still
the right thing to defer.

## The charset finding — the more important result

`MOVE IO-STAT2 TO TWO-BYTES-RIGHT` then reading the binary yields **the
character's code**. Under the certified toolchain that is ASCII: `'A'` is
65, and the program prints `9065`. On the customer's z/OS it is EBCDIC:
`'A'` is 193, and the same program prints `9193`.

Equivalence is unaffected — our claim is Java ≡ COBOL **as built by the
certified toolchain**, and both sides would say 65. But this is the first
construct where the dialect gap moves a **business-visible value** rather
than an edge-case rounding, and a customer reading `9065` in a certified
Java diagnostic needs to know their mainframe prints `9193`.

Two consequences, and the first is not optional:

- **Detect and disclose charset sensitivity per module.** When a byte
  window feeds a character code into a numeric reading, the certificate
  must say so explicitly, in the same way `externalServices` names a
  modelled service (`docs/external-services.md`). Certifying such a
  module silently would be a mis-answer dressed as a pass.
- ~~**The real fix is an EBCDIC-configured reference build.**~~
  **Measured and withdrawn — see `docs/charset.md`.** GnuCOBOL's
  collating sequence and its storage encoding are independent, and only
  the first is configurable: with `PROGRAM COLLATING SEQUENCE IS EBCDIC`
  declared, comparisons do change, but a byte still reads **65** for
  `'A'`, never 193. So no reference build in this toolchain can give a
  byte window mainframe values. **Disclosure is the only honest route
  for byte windows**, which makes the first bullet not merely advisable
  but the whole answer.

  The collating half of the question turned out well: a customer source
  that declares its sequence is already honoured faithfully, and no
  certificate issued so far is exposed (0 of 28 certified modules order
  alphanumeric operands at all).

## Probes

- `examples/probes/bytewindow-basic.cbl` — sizes, byte order, the
  truncating read, and both reference-modification writes.
- `examples/probes/bytewindow-status.cbl` — `9910-DISPLAY-IO-STATUS`
  verbatim from `CBACT02C`, the shape eight real modules share.
- `examples/probes/bytewindow-desugar.cbl` — the killed shortcut, kept
  so nobody re-proposes it without re-running the disagreement.
