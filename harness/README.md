# harness/ — sandboxed legacy execution

## Purpose

Runs the *real* legacy toolchain inside Docker so verification evidence
stops being conditional on mock fidelity. The GnuCOBOL image compiles the
legacy module at build time; every verification case then executes it via

```
docker run --rm -i --network none legacymind/legacy-payroll
```

which the diff-exec harness treats as just another argv — no verifier code
knows Docker exists.

## Sandbox properties

| Requirement (founding spec) | Status |
|---|---|
| No network | `--network none` on every run |
| Ephemeral filesystem | `--rm`; nothing mounted, nothing persists between cases |
| Deterministic clock | libfaketime baked into the image; inject per-side via the verify config's `env` (`LD_PRELOAD` + `FAKETIME`). Not exercised by payroll (time-free). |
| No credentials / host mounts | The program is compiled into the image; configs carry no paths |

## Building a legacy image

From the repo root:

```
.\harness\build-legacy-image.ps1                       # examples/payroll.cbl
.\harness\build-legacy-image.ps1 -Source examples/x.cbl -Tag legacymind/legacy-x
```

(or the equivalent `docker build` on other platforms — see the script.)
The image records its compiler in `/opt/legacy/cobc-version.txt`.

## Mock validation

`examples/mock-validation.json` points the harness at the real binary as
"legacy" and the Node mock as "modern": the pipeline verifies its own test
double. Run it with `--layer B` and `--layer A`. A PASS bounds the trust in
mock-based results on machines without Docker; any divergence is a mock
defect and is reported like any other counterexample.

**First finding (2026-07-06):** the initial validation run diverged on
9/200 generated cases — the mock (and the migrated Java candidate) lacked
PIC 9(7)V99 store truncation: GnuCOBOL silently drops integer digits
beyond the PICTURE's 7 positions when no ON SIZE ERROR is declared
(observed: mock GROSS_PAY 11,718,666.53 vs real 1,718,666.53). Both were
fixed (`store()` in the mocks, `storePic97v99()` in the recorded
candidates) and re-validated to 204/204. The certificate issued from
real-binary evidence is `out/certification-real.json`.

## Piping to the image by hand — beware PowerShell

`"lines" | docker run -i …` from PowerShell 5.1 prepends a UTF-8 BOM and
CRLF line endings; the BOM lands inside the first PIC X field and CR breaks
NUMVAL, producing garbage results that look like a binary defect. The
verifier's own spawn path pipes clean LF/no-BOM stdin and is the supported
way to drive the image.

## Failure modes

- **Per-case container start costs ~0.5–1.5s** on Docker Desktop/WSL2, so
  layer A runs (hundreds of cases) take minutes. For high-volume replay, a
  persistent-container `docker exec` mode or an all-inside-one-container
  runner is the planned optimization.
- The Docker daemon must be running; the harness reports a spawn error per
  case otherwise (case status ERROR, never a silent skip).
- The Java side still runs on the host in this MVP. The spec's OpenJDK 21
  image is the symmetric next step so both sides are sandboxed.
- `debian:bookworm-slim` + `gnucobol3` pins the dialect to GnuCOBOL 3.x.
  Customers on Micro Focus / IBM Enterprise COBOL have dialect differences
  the image does not capture — certificates name the exact toolchain.
