# COMP-3 packed decimal — value semantics, bytes unobservable

Design for `USAGE COMP-3` / `PACKED-DECIMAL` support: the top real-world
data-division blocker (customer records are full of packed amounts), and
the first construct where the corpus is not merely scaffold-inflated but
**silent** — it cannot rank this at all. This is a design-first stage:
ground truth is measured and validated below, the sound subset is fixed,
and one live hole found during probing is closed now; the engine build is
the follow-on stage.

## The corpus population, measured

Across all 459 NIST CCVS files: **zero** occurrences of `COMP-3`,
`COMPUTATIONAL-3`, or `PACKED-DECIMAL` — against 839 `COMP` + 533
`COMPUTATIONAL` (binary) and 249 `INDEX` instances in the same files.
(First measurement pass used a case-sensitive `*.cbl` glob against the
uppercase `.CBL` corpus and returned a false zero for *everything*; the
census above was re-run with a pattern verified to hit known-present
tokens. A zero is only a measurement when the instrument is proven live.)

Packed decimal is a vendor (IBM) extension, so the conformance suite
never tests it — while in real enterprise COBOL it is the default usage
for money and dates in file records. The whole ProLeap fixture corpus
contains exactly two mentions: `PIC S9(5) COMP-3` (the canonical shape)
and a bare level-01 `PACKED-DECIMAL` with no PICTURE — which GnuCOBOL
3.1.2 refuses to compile (`PICTURE clause required`), so that shape
carries no obligation. The corpus-capability well being dry (finding 8
territory), this stage is justified by real-world idiom judgment, not
counts: an engagement's data division will contain COMP-3 or the
engagement is not real.

## Ground truth, validated (GnuCOBOL 3.1.2, pinned container)

`examples/probes/comp3-layout.cbl` writes a record of six COMP-3 fields
through record-sequential file I/O; the bytes came back exactly the
textbook IBM layout, nibble for nibble, matching the hand-computed
expectation before the probe ran:

| PIC | value | bytes | rule confirmed |
|---|---|---|---|
| `S9(5)` | 12345 | `12 34 5C` | sign nibble `C` = positive |
| `S9(4)` | 987 | `00 98 7C` | even digits → leading pad nibble `0` |
| `9(3)` | 42 | `04 2F` | unsigned → sign nibble `F` |
| `S9(3)V99` | −1.5 | `00 15 0D` | scale is positional; `D` = negative |
| `S9(5)` | −12345 | `12 34 5D` | |
| `9(4)` | −7 | `00 00 7F` | unsigned stores absolute value |

Width = `ceil((digits + 1) / 2)` bytes, always one sign nibble, digits
right-aligned against it. Nothing GnuCOBOL-idiosyncratic appeared.

`examples/probes/comp3-parity.cbl` runs the same computations through a
DISPLAY-usage and a COMP-3 twin and compares **inside COBOL** plus on
stdout. Every check came back equal:

- `COMPUTE ... ROUNDED` division: identical (`+04115.22` both).
- Truncation on store (`123456.789` into `9(3)V99`): identical
  (`456.78` both).
- `ON SIZE ERROR`: fires on both twins.
- `DISPLAY` of a negative COMP-3 prints the **same canonical form** as
  the DISPLAY-usage twin (`-00123.00` both) — the existing runtime's
  numeric formatting is reusable unchanged.
- `MOVE` of a negative literal to an unsigned field: absolute value,
  both.

`examples/probes/comp3-corners.cbl` (corners) and
`examples/probes/comp3-readback.cbl` (input side):

- Overflow wraps decimally, mod 10^digits, same as DISPLAY (`9999 + 1 =
  0000` both twins). The spare high nibble of an even-digit field is
  unreachable through arithmetic.
- Arithmetic zero is **sign-normalized to `C`**: `−5 + 5` stores byte
  `0C` (verified by INSPECT over a REDEFINES view), never `0D`.
- Read-back of written `C` / `D` / `F` sign nibbles all decode
  correctly; `F` reads as positive.
- **Malformed BCD is garbage-in-garbage-out, silently.** Bytes
  `1A 34 BC` read into `S9(5)` display as `+1:340` (the `A` nibble
  blindly rendered as ASCII `:`), and the *same field* MOVEd onward
  yields a different nonsense value (`+0020351`), exit code 0. GnuCOBOL's
  behavior on non-canonical packed input is an artifact of its internal
  conversion, not a semantics — it is exactly the thing we refuse to
  emulate.

So the model is: **a COMP-3 field is an ordinary decimal variable**
(digits, scale, sign — the type the IR already carries) **plus a storage
codec that only file I/O can observe**, with equivalence on the input
side quantified over canonical BCD only. The shape of the claim is the
same as O3-flat's "bytes unobservable" argument, with the codec at the
record boundary.

## What the pipeline does today — a hole, found and closed

Probing the production frontend with a compute-only COMP-3 module
(`comp3-parity` shape, minus the gated `ON SIZE ERROR`) returned
`ok:true`: the declaration switch mapped `COMP`, `COMP_3`, `BINARY`, and
`PACKED_DECIMAL` to usage *strings* instead of rejecting, and only the
**consumers** gated on them — record slicing ("stage 2b decodes DISPLAY
bytes only"), the REDEFINES shape classifier, the table element-shape
predicates. A module that dodged every consumer flowed through with
`usage: "COMP-3"` riding opaquely in the IR, and `assess` would have
called it VERIFIABLE with nothing designed behind it.

How bad was it in practice? For **COMP-3**, luckily benign: the probes
above show value semantics identical to DISPLAY, so the IR's decimal
model happens to be exact. For **binary COMP** nobody had measured
anything — Layer C proves obligations against the IR's *decimal* model,
Layers A/B only sample the binary, so any divergence of binary semantics
from that model on unsampled inputs was a certifiable false claim
waiting to happen. No wrong claim was actually made: all 15 VERIFIABLE
modules in the stage-61 NIST assessment were checked and none declares
any COMP variant, and no benchmark module does either. But the shape —
permissive declaration, strict consumers — is precisely how silent scope
creep enters a system whose entire pitch is that nothing enters
silently.

**Closed in this stage**: the declaration switch now rejects every
non-DISPLAY usage loudly and specifically — `USAGE COMP`/`BINARY` as
"binary — unmeasured semantics, outside the verified subset", `USAGE
COMP-3`/`PACKED-DECIMAL` as "packed decimal — designed (docs/comp3.md),
build pending". The consumer gates stay as belt and braces. The p6 probe
now returns the enumerated rejection, the 26-module benchmark is
byte-identical (no module declares a usage), and the NIST assessment
keeps its 15 VERIFIABLE verdicts while the blocker table gains the usage
rows.

## The design — sound subset for the build stage

**C3-1, value subset.** Elementary COMP-3 items (signed/unsigned, `V`
scale, ≤ 18 digits) in WORKING-STORAGE, in arithmetic, `MOVE`,
comparison, and `DISPLAY` contexts. `COMP_3` and `PACKED_DECIMAL`
normalize to one usage string (`COMP-3` — they are the same thing).
The frontend accepts and emits the usage attribute; the IR type is the
ordinary decimal type it already is. **Layer C is untouched** — this is
the load-bearing consequence of measured value-parity, and the crux to
re-verify empirically during the build (stage-53b reflex: hand-build the
module, watch the obligations realize, before trusting the claim).
Java-side codegen treats the variable exactly as a DISPLAY numeric.

**C3-2, record subset.** COMP-3 leaves inside FD records extend the
stage-2b byte-layout model with a packed codec:

- *Write side*: deterministic encode — width `ceil((digits+1)/2)`, pad
  nibble 0, digits packed, sign nibble `C`/`D` for signed (zero → `C`),
  `F` for unsigned. Golden bytes = the comp3-layout probe record.
- *Read side*: decode canonical BCD (digit nibbles 0–9, sign nibble
  `C`/`D`/`F`). **Non-canonical input is a disclosed precondition, not
  an emulation target**: the readback probe shows GnuCOBOL's GIGO
  behavior is internal-artifact, so the certificate states equivalence
  over well-formed packed inputs, and the modern side rejects
  non-canonical bytes loudly at runtime rather than reproducing
  garbage. Harness-generated verification inputs are canonical by
  construction.

**Enumerated residuals (stay gated, named in rejections):**

- `REDEFINES` over or under a COMP-3 item (byte observation — the exact
  thing the model declares unobservable; the corners probe used one, in
  COBOL, as an instrument — supporting it is a different, byte-modeled
  epic).
- Binary `COMP`/`BINARY` (unmeasured; would need its own ground-truth
  stage — truncation config semantics are a known swamp).
- COMP-3 as OCCURS element (auto-gated today by the O1/O2x/O3 element
  shape predicates; lift only with its own probe pass).
- Group `MOVE` involving mixed-usage groups other than the established
  layout-identical `WRITE ... FROM` desugar.
- `SIGN`, `SYNCHRONIZED`, `JUSTIFIED` (already rejected at declaration).

**Layer impact:** frontend — accept + normalize + record-slot codec tag;
ir-core — `usage` stays a carried string, validator unchanged (the
frontend is the gate); record protocol — `decode: "packed"` slot kind
plus encoder; Java runtime — packed codec, nothing else; Layers A, B, D
— nothing; Layer C — nothing (verified during build, not assumed).

**Build-stage de-risk plan:** before touching the engine, hand-write the
target module (WS COMP-3 compute + a packed field in the output record)
and its candidate Java, push both through parse → verify by hand, and
confirm (a) Layer C realizes the same obligations as the DISPLAY twin,
(b) the packed writer's bytes match the probe goldens, (c) candidate B's
seeded defect is caught by the layer that should catch it. Then wire the
frontend acceptance. Benchmark bar as always: 26/26 byte-identical, new
module certified with the packed-input precondition disclosed in the
certificate.

## Probes

- `examples/probes/comp3-layout.cbl` — byte layout, six shapes, golden bytes above.
- `examples/probes/comp3-parity.cbl` — DISPLAY/COMP-3 twin parity: rounding, truncation, size error, display format, unsigned store.
- `examples/probes/comp3-corners.cbl` — overflow wrap, negative-zero sign normalization (INSPECT over REDEFINES).
- `examples/probes/comp3-readback.cbl` — file input side: valid signs, malformed-BCD GIGO evidence.
