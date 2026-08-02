# Binary COMP — semantics that belong to the compiler, not the source

**STATUS: V1 VALUE SUBSET BUILT.** `COMP` / `COMPUTATIONAL` / `BINARY`
are accepted as ordinary decimal items (normalised to one `COMP` usage
string), proven exact by an IR twin-diff — a COMP module's IR differs
from its DISPLAY twin in **only** the usage string, which no layer reads.
Residuals still reject loudly: `COMP` in a file record, and `ACCEPT`
directly into a `COMP` item.

Measured real-code effect on AWS CardDemo: the `USAGE COMP` blocker is
gone for **12** modules and `USAGE BINARY` for **10** — and the median
blockers-per-module **moved for the first time in any stage**, 26.0 →
24.5 (minimum 4 → 3). VERIFIABLE remains 0/31: this is the largest
single reduction so far and it still does not flip a module.

The disclosure below is not optional dressing — it is half the stage.

Design for `USAGE COMP` / `COMPUTATIONAL` / `BINARY`: 13 and 10 real
modules respectively (docs/real-code-assessment.md), and the soundness
gate deliberately closed in stage 62, where finding 9 recorded it as a
real exposure — Layer C proves obligations against the IR's **decimal**
model while layers A/B only sample, so an unmeasured divergence would be
a certifiable false claim.

The measurement below justifies that caution and then sharpens it into
something more uncomfortable: **binary COMP semantics are not a property
of the COBOL source at all. They are a property of the compile options.**

## The corpus population, measured

Declaration shapes across AWS CardDemo (`app/cbl` + `app/cpy`):

| count | shape |
|---|---|
| 48 | `PIC S9(09) COMP` |
| 43 | `PIC S9(4) COMP` |
| 30 | `PIC S9(9) BINARY` |
| 22 | `PIC S9(09) BINARY` |
| 20 | `PIC S9(8) COMP` |
| 18 | `PIC S9(04) COMP` |
| 10 | `PIC S9(05) COMP`, 10 `PIC S9(9) COMP` |
| 8 | `PIC S9(09)V99 COMP`, 8 `PIC 9(4) BINARY` |
| 6 | `PIC S9(11) COMP`, 6 `PIC S9(4) BINARY` |

So: 4, 5, 8, 9, 11 digits, mostly signed, with a scaled `V99` tail —
spanning the 2-, 4- and 8-byte binary widths. `COMP` and `BINARY` are
used interchangeably and must behave identically.

## Ground truth (GnuCOBOL 3.1.2, pinned container)

Storage widths are the standard ones — a group of
`S9(4) S9(8) S9(9) S9(11) S9(18)` measures **26 bytes** = 2 + 4 + 4 + 8 + 8.

**Under the pinned toolchain's default dialect, binary COMP value
semantics are identical to DISPLAY** — the same result the COMP-3 stage
reached, and for the same reason (`examples/probes/comp-binary.cbl`):

| check | COMP | DISPLAY twin |
|---|---|---|
| `9999 + 1` in `S9(4)` | `+0000` | `+0000` |
| `MOVE 30000` into `S9(4)` | `+0000` | — |
| `MOVE -1234` | `-1234` | `-1234` |
| `12345.67 * 3` in `S9(9)V99` | `+000037037.01` | `+000037037.01` |
| `100 / 3 ROUNDED` | `+000000033` | `+000000033` |

Arithmetic **truncates to the PICTURE's decimal digits**, not to the
field's binary capacity: 9999 + 1 wraps to 0 (mod 10⁴) even though two
bytes hold 32767.

## The finding that matters: the dialect decides

The same program, same source, three sets of compile options
(`examples/probes/comp-dialect.cbl`):

| options | `9999+1` DISPLAYs | compares as | `> 9999`? |
|---|---|---|---|
| *(default)* | `+0000` | zero | no |
| `-fno-binary-truncate` | `+0000` | **not zero** | **yes** |
| `-std=ibm` | `+10000` | not zero | yes |
| `-std=mf` | `+0000` | not zero | yes |

Three behaviours, and the middle one is a trap: the field **prints
`0000` while branching as though it held 10000**. Its displayed value and
its arithmetic value disagree. A verification stack that compares only
the KV stream would see identical output on both sides and miss a
divergent branch entirely — layers A and B are structurally blind to it,
and only Layer C or D reasoning about the *value* would catch it.

`-std=ibm` — the dialect that models the mainframe a customer is
actually migrating **from** — is the one that disagrees most with our
default: `PIC S9(4) COMP` genuinely holds 10000, and moving 30000 into it
stores 30000. (It also displays `+10000`, five digits in a four-digit
picture, and moves to a DISPLAY field as `0000+`.)

**Consequence for the product.** A certificate that says "this Java is
equivalent to this COBOL" is *meaningless for COMP fields* unless it also
pins the truncation setting. Our certificates name the dialect
(GnuCOBOL 3.1.2) but not this flag, and the flag changes the answer. This
is exactly the class of hidden assumption the project exists to refuse.

## The sound V1 subset

**Value subset, decimal-truncating semantics.** Elementary `COMP` /
`COMPUTATIONAL` / `BINARY` items (signed or unsigned, optional `V`
scale, ≤ 18 digits) in WORKING-STORAGE, used in arithmetic, `MOVE`,
comparison and `DISPLAY`. Under the pinned toolchain the IR's ordinary
decimal type is **exact** for these, so — as with COMP-3 — no verifier
layer changes, and the claim is checked by an IR twin-diff plus a live
Layer C run rather than assumed.

**The certificate must disclose the truncation semantics** it was
established under. Without that line the certificate overstates: it would
read as a claim about the customer's mainframe when it is a claim about
GnuCOBOL's default. This disclosure is the load-bearing part of the
stage.

**Enumerated residuals (rejected loudly):**

- `COMP` in a **file record** — the byte layout is binary and
  endianness-dependent, unmeasured here, and the stage-2b decoder reads
  DISPLAY bytes only (already rejected today);
- `ACCEPT` directly into a `COMP` item (console-to-binary conversion,
  unmeasured — same gate as COMP-3);
- `COMP-1` / `COMP-2` (floating point — a different numeric model
  entirely, and not decimal at all);
- `COMP-5` / native binary, and `SYNCHRONIZED` alignment;
- **any codebase compiled with non-default truncation** — outside the
  envelope until the harness pins the matching flags, which is a
  configuration input the pipeline does not yet take.

## Recommendation

Build the value subset **and** the disclosure together, or neither. The
subset alone is a small, sound win on a construct 13 real modules
declare. The disclosure is what keeps it honest, and it generalises: the
dialect statement in `docs/certificate-guide.md` should name truncation
behaviour alongside the compiler version, because this is the first
construct found whose meaning changes with a compiler flag rather than
with the source.

A follow-on worth scoping separately: accept the customer's compile
options as a pipeline input and verify against *their* dialect. That is
the only way a COMP-bearing certificate is meaningful for a real z/OS
migration, and this measurement is the argument for it.

## Probes

- `examples/probes/comp-binary.cbl` — COMP vs DISPLAY twin across
  overflow, capacity, negatives, scaling, rounding; group byte widths.
- `examples/probes/comp-dialect.cbl` — the display-vs-comparison
  divergence, run under default / `-fno-binary-truncate` / `-std=ibm`.
