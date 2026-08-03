# The raw output protocol — and two vacuous passes it exposed

Pointing the harness at real third-party code for the first time broke an
assumption that had been invisible for the whole life of the benchmark:
**that a module's output is `KEY=VALUE` lines.**

Every one of the 28 benchmark modules emits `KEY=VALUE`, because they were
written to. `CBACT02C` — untouched AWS CardDemo — prints a banner, a run
of 150-byte card records, and a closing banner. Under the `kv-lines`
protocol that parses to **zero fields on both sides**.

## What that meant, measured

A Java candidate that reads its input and prints **nothing at all**:

```java
while (in.readLine() != null) { /* consume, emit nothing */ }
```

against the real GnuCOBOL binary printing three records:

```
PASS  three-cards
      note: legacy: unparsed output line: "START OF EXECUTION OF PROGRAM CBACT02C"
      note: legacy: unparsed output line: "4111111111111111100000000011230ALICE …"
      note: legacy: unparsed output line: "END OF EXECUTION OF PROGRAM CBACT02C"

verdict: PASS  (1/1 passed, 0 failed, 0 errored)
```

**A pass, comparing nothing.** "No differences among no fields" is not
evidence, and the unparsed lines were recorded as notes rather than as the
failure they represented.

Layer D had the same hole from the other direction: it compares the
derivation of each output *key*, and with no keys it reported
`PASS (0/0 keys verified)`.

Neither was reachable from the benchmark. Both were reachable the moment
the tool met real code — which is exactly the class of defect this project
exists to refuse.

## The fix

**1. A `raw` output protocol.** `protocol.output: "raw"` compares stdout
**byte for byte**. That is the honest contract for real COBOL, which
prints records rather than pairs, and it is strictly stronger than field
comparison — no tolerance, no parsing, no lines quietly ignored.

**2. Zero compared fields is never a pass.** Under `kv-lines`, if neither
side yielded a field, the case falls back to raw stdout equality and says
so in a note. This cannot regress a module that does emit fields, and it
means no configuration mistake can produce a vacuous pass again.

**3. Layer D reports `NO-EVIDENCE`, not `PASS`.** With zero output keys it
has examined nothing, so it says that. `certify` records a `NO-EVIDENCE`
layer as **NOT_RUN** with the reason — so it cannot count towards "at
least one supporting layer", and a layer that examined nothing can never
be what certifies a module.

The same empty candidate now **FAILs**.

## Real code through the harness

`CBACT02C` reads an INDEXED (VSAM) file. The harness supplies the logical
record set as a text seed and a loader materialises the file
(`docs/vsam.md`); the seed is deliberately **unsorted**, so the index's
key ordering is observable and the modern side has to reproduce it — which
is what a real VSAM migration must do.

Two harness capabilities were missing and are now present:

- **`parse --copybooks <dir>`.** `assess` could always resolve a copybook
  library; `parse` could not, so every module that COPYs anything was
  assessable but not certifiable. Real code COPYs.
- **A copybook directory in the indexed image** (`COPYDIR`), so the
  compile inside the container sees the same library the assessment
  resolved against.

Result, against the real binary:

| layer | result |
|---|---|
| A — property, 200 generated record sets | **PASS 200/200** |
| B — curated, byte-for-byte (`raw`) | **PASS 5/5** |
| C — symbolic | **refuses**: byte-modelled storage (`docs/byte-window.md`) |
| D — static data-flow | **NO-EVIDENCE**: no `KEY=VALUE` keys to compare |

Cases cover the empty file, one card, an unsorted three-card set, a
key-order boundary, and an all-spaces name.

## What is still missing for a certificate

The Java above is **hand-written**, to the shape `migrate` emits. A
certificate over hand-written code would prove nothing about the pipeline,
so the module is **not certified**. The remaining step is a live `migrate`
run, which this environment cannot perform — no `ANTHROPIC_API_KEY` and no
auth profile. `migrate --offline` stops exactly there, loudly, naming both
cache keys and writing both request stubs:

```
no cached response for c92ff74589a5898c… and --offline was requested.
  The full request was written to:
    transpiler/cache/c92ff74589a5898c….request.json
legacymind: migrate: 2 candidate(s) unresolved — record responses or provide credentials
```

So the honest position is unchanged in the only way that matters:
**`CBACT02C` is eligible and demonstrated end-to-end against the real
binary; it is not certified.** What stands between the two is one
transpiler run, not another engine stage.
