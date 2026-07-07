# LegacyMind legacy-execution image: real GnuCOBOL, sandboxed.
#
# The legacy program is compiled INTO the image at build time, so verify
# configs need no volume mounts or machine-specific paths — the argv is
# just: docker run --rm -i --network none <tag>
#
# Sandbox properties when run as documented:
#   --network none   no network egress from legacy code
#   --rm             ephemeral filesystem, nothing persists between cases
#   (image is never given credentials or host mounts)
#
# Deterministic clock injection: libfaketime is installed. For modules that
# read the clock (payroll does not), pin time per run via the side's "env"
# in the verify config:
#   "env": { "LD_PRELOAD": "/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1",
#            "FAKETIME": "2026-01-01 00:00:00" }
# passed through with docker run -e LD_PRELOAD -e FAKETIME.

FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends gnucobol3 libfaketime \
 && rm -rf /var/lib/apt/lists/*

# Path of the COBOL source within the build context (repo root).
ARG SOURCE=examples/payroll.cbl
COPY ${SOURCE} /opt/legacy/program.cbl

RUN cobc -x -o /opt/legacy/program /opt/legacy/program.cbl \
 && cobc --version | head -n 1 > /opt/legacy/cobc-version.txt

ENTRYPOINT ["/opt/legacy/program"]
