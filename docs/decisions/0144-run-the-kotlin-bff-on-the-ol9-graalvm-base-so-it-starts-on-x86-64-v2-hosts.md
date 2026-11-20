---
status: accepted
summary: The Kotlin BFF template's Jib base moves from the default GraalVM JDK 25.0.2 image, built for x86-64-v3, to its Oracle Linux 9 variant pinned by digest, which starts on x86-64-v2 hosts; the AOT cache is still retrained on every build.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0144: Run the Kotlin BFF on the OL9 GraalVM base so it starts on x86-64-v2 hosts

Source: [`infra/plans/15-next-horizon.md` § Step 4](../../infra/plans/15-next-horizon.md#step-4-golden-path-templates), delivered by issue #1441.

Refines: [ADR 0046](0046-bff-jvm-with-agent-and-aot-cache.md) and [ADR 0116](0116-application-runtime-images-are-distroless-builder-stages-can-be-anything.md).

## Context

The delivery host `kore-agents` has a Xeon E5-1620 v2: x86-64-v2, with no AVX2.
The Jib base that [ADR 0046](0046-bff-jvm-with-agent-and-aot-cache.md) names is
`ghcr.io/graalvm/jdk-community:25.0.2`, pinned by digest. That image is built for
x86-64-v3. On the host, `docker run --rm` of it runs `java -version` and stops
with `Fatal glibc error: CPU does not support x86-64-v3` (reproduced on 2026-11-20,
exit 127). The golden-path Application stays Degraded and `kore local up` exits 1,
so the live proofs in #1114 and #1210 both ended blocked. ADR 0046 pinned the base
for its JDK and its digest, but not for the CPU level the base must start on.

The same GraalVM CE 25.0.2+10.1 JDK is published on three bases: the unsuffixed
`25.0.2` tag is the Oracle Linux 10 build, and `25.0.2-ol8` and `25.0.2-ol9` are
the older OS lines.

## Decision

- **The base is the OL9 variant.** The Jib base, which is also the base that
  `aotTraining` and `aotVerify` run, is
  `ghcr.io/graalvm/jdk-community:25.0.2-ol9@sha256:3a9d4b5ef050893a6bfd683ecff0b0de3da3b89d40fda513c9acf9932dec0d9d`.
  `java -version` exits 0 with it on `kore-agents` on 2026-11-20. The OL9 line is
  the newest OS whose glibc starts on x86-64-v2, so it keeps newer packages than OL8.
  `25.0.2-ol8` (digest `sha256:9f3568a6a186e743e6c01883196f45fafc5b41689665d06656ebe8f8c4d83ab4`)
  also starts on the host, and was not chosen for that reason.
- **The JDK, flags, agent and classpath do not change.** It is the same JDK build,
  the same OpenTelemetry Java agent pinned by version and checksum, the same training
  flags and the same class path order. Only the base digest moves.
- **The AOT cache is retrained in CI.** The cache is valid only for the exact JDK,
  so the training run uses the new base. `aotTraining` runs in the release job's Gradle
  step on the GitHub runner, not on `kore-agents`, so no image is built on the host.
  `aotVerify` still refuses a cache the runtime rejects.
- **Publishing is a dark launch.** The release job builds, pushes and signs the image
  on the next release tag, as it does for the other template images. Nothing deploys
  it then. A deployment reads the BFF digest only through the lock bump, a separate
  cluster-facing PR with its own safety pattern and a live run before merge (the
  #1114 and #1210 rerun). No flag is turned on by this decision, and no live-run
  outcome is recorded here.
- **This refines ADR 0046 and ADR 0116.** From ADR 0046 only the base digest changes;
  the JVM, the agent and the cache design stand. From ADR 0116 the BFF runtime stays
  on a base that is not distroless, as it was before. The Kotlin BFF row in ADR 0116's
  follow-up table is still open and remains its own expand-contract PR, so this is an
  interim state and not a new exception.

## Consequences

- The BFF's OS changes from OL10 to OL9 for every build of the template, on every host.
  The OL9 base is built for the RHEL 9 CPU baseline, x86-64-v2, which is the basis for
  the choice. The one host checked is `kore-agents`.
- Startup to readiness on the new base is not measured here. ADR 0046's budget still
  decides whether autoscaling starts earlier, and the live run measures it.
- Rollback is a revert of the base digest. The cache is retrained on the next build,
  so no cache needs to be undone.
- The template spec pins the new digest and asserts the old one is gone
  (`tools/kore/integration/config/kotlin-bff-template.spec.ts`).
