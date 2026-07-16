# LegacyMind IR-core image: the Rust typed IR contract as a pipeline gate.
#
# Multi-stage: the pinned official Rust toolchain builds the release
# binary (this machine has no host Rust - the container IS the toolchain,
# the same pattern as GnuCOBOL in harness/gnucobol); the runtime stage is
# the same slim Debian base the legacy images use, carrying only the
# binary. Run as:
#
#   docker run --rm -v <abs>/out/ir:/ir:ro legacymind/ir-core /ir/X.ir.json
#
# Sandbox properties: no network needed at runtime, read-only IR mount,
# nothing persisted (--rm). Build from the repo root:
#
#   docker build -f ir-core/Dockerfile -t legacymind/ir-core .

FROM rust:1-slim AS build
WORKDIR /crate
COPY ir-core/Cargo.toml ir-core/Cargo.lock ./
COPY ir-core/src ./src
RUN cargo build --release --locked --bin validate-ir

FROM debian:bookworm-slim
COPY --from=build /crate/target/release/validate-ir /usr/local/bin/validate-ir
ENTRYPOINT ["validate-ir"]
