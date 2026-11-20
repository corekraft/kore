# Kotlin BFF template

Golden-path template for a Kotlin Spring Boot backend for frontend
([ADR 0046](../../docs/decisions/0046-bff-jvm-with-agent-and-aot-cache.md)).

- Jib builds the image on the pinned GraalVM JDK, run as a JVM. The base is the
  Oracle Linux 9 variant of JDK 25.0.2, which starts on x86-64-v2 hosts
  ([ADR 0144](../../docs/decisions/0144-run-the-kotlin-bff-on-the-ol9-graalvm-base-so-it-starts-on-x86-64-v2-hosts.md)).
- The OpenTelemetry Java agent is downloaded by version and checked against its
  pinned SHA-256 before it is used.
- `aotTraining` runs the app once in the same base image with the agent, stops
  after the Spring context refreshes, and writes the JDK AOT cache that Jib adds
  as a layer.

Build: `gradle jib --image=<ref>` (needs Docker for the training run). Nothing
deploys this template yet; the live build and startup measurement are owed.
