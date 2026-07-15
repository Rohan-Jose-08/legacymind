# LegacyMind modern-execution image: a pinned OpenJDK, sandboxed.
#
# The verified benchmark runs both sides of every differential comparison
# under the same discipline. The legacy side already runs in a pinned
# GnuCOBOL container with no network and an ephemeral filesystem
# (harness/gnucobol/Dockerfile); this image gives the MODERN (Java 21)
# side the same properties, so the certificate's provenance covers the
# whole comparison rather than trusting an unpinned host JDK.
#
# Sandbox properties when run as documented:
#   --network none   no network egress from the candidate
#   --rm             ephemeral filesystem, nothing persists between cases
#   -v <classes>:/work:ro   the compiled candidate, read-only; no host
#                           mount is writable and none carries credentials
#
# Candidates are compiled on the pipeline side with `javac --release 21`,
# so their bytecode runs on this pinned Java 21 runtime unchanged; the
# image is a JRE (run only), never given the source.
FROM eclipse-temurin:21.0.5_11-jre-jammy

# A stable, unprivileged workdir the classpath mounts onto.
WORKDIR /work
ENTRYPOINT ["java"]
