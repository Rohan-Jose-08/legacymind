# Character set and collating sequence — what transfers to z/OS

`docs/byte-window.md` closed with a recommendation: that the real fix for
charset divergence was **a reference build configured for the customer's
code page**, so equivalence would be established under EBCDIC rather than
merely disclosed as ASCII.

**That recommendation was measured and is wrong for the case that
prompted it.** It is right for one half of the problem and impossible for
the other, and the two halves have to be separated.

## The two halves

| | what it governs | configurable in the certified toolchain? |
|---|---|---|
| **collating sequence** | how alphanumeric values ORDER (`<`, `>`) | **yes** |
| **storage encoding** | what BYTE a character is | **no** |

GnuCOBOL 3.1.2 honours `PROGRAM COLLATING SEQUENCE IS <ebcdic alphabet>`
for comparisons, but the bytes in memory stay ASCII. So a byte window
still reads 65 for `'A'`, never 193 — and the byte window was the entire
reason the question was asked.

## Ground truth (GnuCOBOL 3.1.2, pinned container)

Probes: `examples/probes/charset-*.cbl`.

```cobol
OBJECT-COMPUTER. XXX PROGRAM COLLATING SEQUENCE IS EB.
SPECIAL-NAMES.  ALPHABET EB IS EBCDIC.
```

| test | native | EBCDIC collation |
|---|---|---|
| `WS-A < WS-0` (variables, `'A'` vs `'0'`) | FALSE | **TRUE** — collation applied |
| `WS-A < "0"` (variable vs literal) | FALSE | **TRUE** — collation applied |
| `"A" < "0"` (**literal vs literal**) | FALSE | **FALSE** — *not* applied |
| `MOVE WS-A` to a byte, read as binary | 65 | **65** — storage unchanged |

Two things follow, one minor and one decisive.

**Minor:** a literal-versus-literal comparison is constant-folded in the
native sequence and ignores the declared collation — `-Wall` even reports
it as "always FALSE" while a variable holding the same value compares
TRUE. It is an inconsistency inside one program, but comparing two
literals is a constant expression that real code does not write. Noted,
not feared.

**Decisive:** `BYTE_OF_A = 65` under EBCDIC collation. Collation and
encoding are independent, and only the first is reachable. **No compile
option in this toolchain makes a byte window yield mainframe values.**

## What is actually charset-sensitive — a much smaller set

Order is preserved *within* a character class and only flips *across*
classes. Measured, not inferred from code charts:

| compared values | native | EBCDIC | |
|---|---|---|---|
| `"AB"` vs `"AC"` (uppercase) | same | same | order preserved |
| `"12"` vs `"13"` (digits) | same | same | order preserved |
| `"2026-01-31"` vs `"2026-02-01"` (dates) | same | same | order preserved |
| `"A1"` vs `"1A"` (**mixed**) | `A1 >= 1A` | **`A1 < 1A`** | **flips** |

EBCDIC is not contiguous across letters (`A`–`I`, `J`–`R`, `S`–`Z` sit in
separate ranges) but it is monotonic within each class, which is why
same-class comparisons survive. So:

> An ordering comparison is charset-sensitive **only if its operands can
> span different character classes** (digit vs letter, or letter case).
> Equality is never sensitive — byte equality survives any bijection.

## Exposure today, measured

| corpus | result |
|---|---|
| the **28 certified** benchmark modules | **0** affected — 87 alphanumeric items declared, no ordering comparison on any of them |
| AWS CardDemo (31 modules, source-level) | **1** ordering comparison on alphanumerics: `IF TRAN-PROC-TS (1:10) >= WS-START-DATE` in `CBTRN03C` — digit-and-hyphen timestamps, so **order-preserving and unaffected** |

**No certificate already issued is exposed to the collating-sequence
gap.** That is a real finding, and it was nearly a false one — see below.

### The instrument was dead the first time

The first sweep reported "0 of 28" from a detector that could not fire at
all: its `\b` regex escapes were mangled by shell quoting, so every name
test returned false. A positive control — a module written specifically
to contain `IF WS-NAME > WS-LIMIT` — is what exposed it. The scanner was
rewritten to tokenize and compare tokens exactly, with **no regex
escaping anywhere**, and the control now fires before the sweep runs.

This is the sixth time a zero has turned out to be an instrument
artifact. A zero is a measurement only when the instrument is proven live
on the same run.

## Decision

1. **Byte windows must disclose, not re-verify.** The EBCDIC reference
   build cannot deliver mainframe byte values, so a module whose output
   depends on a character's code is certified *under the certified
   toolchain's encoding* and must say so per module — the
   `externalServices` pattern (`docs/external-services.md`), applied to
   encoding. `docs/byte-window.md` is corrected accordingly.

2. **Collation is different and is worth honouring.** If a customer's
   source declares `PROGRAM COLLATING SEQUENCE`, GnuCOBOL already applies
   it and our reference build is faithful with no change. If it does
   *not* declare one — the common case — the customer's mainframe compiler
   uses EBCDIC natively while ours uses ASCII, and any **cross-class**
   ordering comparison then diverges. That case is detectable statically
   and today affects nothing we have certified.

3. **Detect both, gate neither yet.** Neither condition occurs in the
   benchmark or in the parts of CardDemo we can reach, so building the
   gate now would be building against zero real instances. The scanner
   exists (`docs/charset-scan.mjs`, which fires on a positive control
   before it reports a zero); wire it into `assess` and
   into `certify`'s disclosure when the first real module that needs it
   appears — which, on current evidence, will be a byte-window module,
   not a comparison one.

## Probes

- `examples/probes/charset-collate.cbl` — variable, mixed, and
  literal-versus-literal comparisons under a declared EBCDIC sequence,
  with the byte-value read that settles the storage question.
- `examples/probes/charset-classes.cbl` — which comparison classes
  survive the sequence change and which flip.
