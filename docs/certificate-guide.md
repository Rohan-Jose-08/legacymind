# Reading and verifying a LegacyMind certificate

This guide is for the engineer or auditor evaluating a LegacyMind
equivalence certificate. It explains exactly what the certificate
asserts, what it deliberately does **not** assert, and how to verify its
authenticity yourself — including with no LegacyMind software, using
about thirty lines of code you can read in full.

The design principle behind every field is **no hidden failures**:
anything the verification could not establish is enumerated in the
certificate, never omitted. A certificate is worth auditing precisely
because it is built to disclose its own limits.

## What a certificate is

A LegacyMind certificate is a signed, tamper-evident record that one
specific Java program (the *target*) was checked for behavioural
equivalence against one specific COBOL program (the *source*), by four
independent verification layers, and that the checks passed within a
stated coverage envelope. Both programs are pinned by SHA-256 hash, so
the certificate is about *those exact bytes* and nothing else.

It is **not** a claim that "the migration is correct" in the abstract. It
is a claim about a named source, a named target, a named toolchain, and a
named set of checks — each of which you can re-run.

## Anatomy — a worked example

The examples below use a real certificate for the `FREIGHT` module.

### Identity: what was checked

```json
"module": { "programId": "FREIGHT",
            "source": { "file": "benchmark/modules/freight.cbl",
                        "sha256": "6131178209cb36fd…" } },
"target": { "file": "…/candidate-a/Freight.java",
            "sha256": "91d4202993a42a82…",
            "model": "claude-opus-4-8", "candidate": "a" }
```

- **source.sha256 / target.sha256** — the exact COBOL and Java bytes
  under certification. Hash your copy of each file and compare; if either
  differs, this certificate does not apply to your files.
- **model / candidate** — provenance of how the Java was produced. The
  translator is disclosed but is *not* what you are trusting: the
  verifier checks the output regardless of how it was generated. A
  human-written Java file would be certified by the identical process.

### Verdict and the four layers

```json
"verdict": "CERTIFIED",
"layers": { "A": {"status":"PASS", …}, "B": {"status":"PASS", …},
            "C": {"status":"PASS", …}, "D": {"status":"PASS", …} }
```

`verdict` is `CERTIFIED` only when every layer that ran passed and the
disclosed gaps do not undermine the claim. The four layers are
deliberately different *kinds* of evidence, so that a mistake one layer
is blind to is caught by another:

- **Layer A — property-based differential testing.** Hundreds of inputs
  are generated from the source's own data shapes and run through the
  **real GnuCOBOL binary** and the Java, comparing every output. FREIGHT:
  `200/200` generated cases matched. The `seed` is recorded so the exact
  set is reproducible.
- **Layer B — curated differential selection.** A hand-chosen set of
  edge cases (boundaries, ties, zero, maximum) run the same real-binary
  vs Java comparison. This is also how the winning candidate was selected
  against the real binary. FREIGHT: `7/7`.
- **Layer C — symbolic execution.** Not sampling — this reasons about the
  program's arithmetic *obligations* (rounding boundaries, branch
  conditions) and solves for the exact inputs that sit on each boundary,
  then confirms source and target agree there. FREIGHT: `2/2 obligations
  verified`, both with witnesses confirmed on the real binary. An
  obligation it cannot solve is reported as `unrealized`, never dropped.
- **Layer D — static data-flow.** With no execution at all, it checks
  that every output value is *derived* the same way on both sides — it
  catches a program that prints the right bytes for the wrong reason.
  FREIGHT: `3/3` output keys verified.

Each layer entry carries a `report` with its own SHA-256, so the detailed
per-case evidence file is itself pinned and tamper-evident.

### The coverage envelope and gaps — where honesty lives

```json
"coverageEnvelope": {
  "layerA": { "generatedCases": 200, "seed": 20260717 },
  "layerC": { "obligations": {"total":2,"verified":2,"unrealized":0},
              "pathsCovered": "2/2" },
  "gaps": []
}
```

This is the most important section for an auditor. It states the *extent*
of the verification in numbers you can check, and `gaps` lists — in plain
language — everything the verification could not establish. A certificate
with `"gaps": []` claims full coverage of its obligations; a certificate
with entries in `gaps` is still a valid certificate, but it is telling
you precisely where its assurance stops (for example, a rounding
obligation that could not be solved, or an output key that static
analysis could not resolve). **A non-empty `gaps` list is a feature, not
a defect** — it is the product refusing to overstate what it proved.

## Verifying authenticity yourself

The `integrity` block makes the certificate tamper-evident and
attributable:

```json
"integrity": {
  "algorithm": "ed25519",
  "keyId": "9b70a354efb9feab",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----",
  "canonicalization": "json-sorted-keys",
  "contentSha256": "bcb600f540fe0675…",
  "signature": "NRR+1HzYm+fHYfsG…"
}
```

The signature is an Ed25519 signature over the **canonical form** of the
certificate body — the whole document *except* the `integrity` block —
where canonical means JSON with object keys sorted recursively. Sorting
keys means the certificate can be re-formatted or re-serialised and still
verify, but changing *any value* breaks the signature.

There are two checks, and they are independent:

- **Integrity** — does the signature match the body? If yes, the body has
  not been altered since signing.
- **Provenance** — is the signer's public key the one you trust? The
  `keyId` is the first 16 hex characters of the SHA-256 of the key. Pin
  it against the key LegacyMind gave you out-of-band. Integrity without
  provenance only proves *someone* signed this; provenance proves *who*.

### Option 1 — the LegacyMind CLI

```bash
legacymind verify-cert certification-freight.json
```

```
  signature: VALID
  content hash: matches
  signer key: 9b70a354efb9feab (trusted)
  result: VERIFIED
```

Exit code is `0` only when the signature is valid **and** the signer is
the trusted key; any tampering or unknown signer exits `1`. Pin your own
trusted key with `--trusted-key <ed25519.pub.pem>`.

### Option 2 — independently, with no LegacyMind code

You do not have to trust our CLI. `docs/verify-certificate.mjs` is a
complete verifier using only the Node.js standard library — no
dependencies, about thirty lines, readable end to end. It does exactly
the three steps described above: canonicalise the body, Ed25519-verify
the signature with the embedded public key, and (optionally) pin the
signer's key id.

```bash
node docs/verify-certificate.mjs certification-freight.json 9b70a354efb9feab
```

```
signature valid: true
content hash matches: true
signer key id: 9b70a354efb9feab | trusted: true
verdict in cert: CERTIFIED
```

The algorithm is standard Ed25519 over a canonical JSON encoding, so an
equivalent verifier in Python (`cryptography`), Go, or any language with
an Ed25519 primitive is a few lines — the reference implementation is
just the shortest way to show it. Auditors are encouraged to write their
own; that is the point of an open, standard signature scheme.

### What tampering looks like

Change one value — flip `verdict` to `NOT_CERTIFIED`, edit a hash, alter
a layer result — and both the CLI and the independent verifier report
`signature valid: false` and exit `1`. The signature covers the whole
body, so there is no edit that leaves it intact. Re-signing would require
the private key, which changes the `keyId` to one your pin rejects.

## The signing key and trust model

The public key is embedded in the certificate so it is self-contained,
but **embedding is not endorsement** — a forger could embed their own key
and sign with it. That is why provenance requires pinning the `keyId`
against a key you obtained from LegacyMind through a channel independent
of the certificate itself.

Certificates in the benchmark and demo material are signed with a
**deterministic demo key** (`keyId 9b70a354efb9feab`), which is published
in the repository so anyone can reproduce the benchmark. A demo-signed
certificate proves integrity but carries no provenance weight, by design.
Production certificates for a real engagement are signed with a
private key held in a KMS and never published; you pin its public key
once, out-of-band, and every certificate from that engagement verifies
against it.

## What a certificate does not claim

Stated plainly, so there is no ambiguity in an audit:

- **External services.** Read the `externalServices` block. Real batch
  COBOL calls vendor code — IBM Language Environment services, assembler
  routines — whose implementation nobody outside the vendor has. A
  certificate may name such a service **only when it never returns**
  (today that is `CEE3ABD`, the LE abend service): a call that terminates
  the program has no post-call state, so the unknown implementation
  cannot affect anything downstream. What is covered is that the program
  *reaches* the call under the same conditions in both implementations,
  has produced identical output beforehand, and runs nothing afterwards.
  What is **not** covered is the service's own behaviour and its
  argument values — under the certified toolchain the arguments have no
  observable effect, whereas on z/OS they are visible as the abend code,
  so a modern implementation could pass with a different one. Each such
  service also appears in `gaps`. `checked: false` means no IR was
  supplied and the certificate makes **no statement either way**
  (docs/external-services.md).

- **Dialect, *and its options*.** Read the certificate's `toolchain`
  block: it names the compiler, its version, and **the exact options the
  evidence was produced with**, captured from the harness image itself
  rather than declared. It rides inside the signed body, so altering it
  breaks the signature. If `toolchain.recorded` is `false`, the compiler
  and options are *not* pinned by that certificate and it says so, with a
  matching entry in `gaps`. Equivalence for the benchmark is established
  against **GnuCOBOL 3.1.2** compiled with its **default options** —
  which for binary fields means
  *decimal-truncating* `COMP`. This matters more than it sounds: some
  COBOL semantics are a property of the compiler flags, not of the
  source. A `PIC S9(4) COMP` field computing `9999 + 1` yields `0` under
  the default, and `10000` under `-std=ibm`; under
  `-fno-binary-truncate` it *displays* `0000` while *comparing* as
  greater than 9999. If your production build uses different truncation
  settings, a certificate covering `COMP` fields does not transfer to it
  (docs/binary-comp.md). Verifying against a customer's own compile
  options is a scoped, not-yet-built capability.
- **The verified subset.** Equivalence covers the COBOL constructs the
  source actually uses *and* that fall inside the verified subset. If a
  source used a construct outside the subset, it would not have been
  certified at all — the `assess` tool reports, per module, what is
  verifiable before any certificate is issued. A certificate therefore
  never silently covers an un-verified construct.
- **Well-formed inputs.** Where the reference compiler itself has no
  defined behaviour for malformed input (for example, non-canonical
  packed-decimal bytes, or a record truncated mid-field), the
  verification envelope excludes those inputs explicitly rather than
  certify behaviour the reference does not define. Any such exclusion is
  disclosed.
- **The source's own correctness.** The certificate asserts the Java
  behaves like the COBOL — including any bug the COBOL has. It is an
  equivalence claim, not a correctness claim about the original program.

If any of these boundaries matter to your audit, they are stated in the
certificate and its `gaps`, and the underlying reports (each pinned by
hash) contain the case-level detail.
