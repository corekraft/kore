---
status: accepted
summary: The Kotlin BFF always runs on the GraalVM JDK as a JVM with the OpenTelemetry Java agent, and starts fast from Spring AOT and a JDK AOT cache produced by a training run at build time and baked into the Jib image; native image leaves the golden path.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0046: Run the BFF on the JVM with the Java agent and a build-time AOT cache

Source: [`docs/vision.md` § Backend for Frontend](../vision.md#backend-for-frontend)

Refines: [ADR 0015](0015-local-signed-image-delivery.md), whose Docker build
the Jib build replaces for these services.

## Context

The Kotlin Spring Boot BFF is built with Jib and carries the OpenTelemetry Java
agent so every service is traced without code. A GraalVM native image starts
fastest, but the agent cannot run inside one. A plain JVM keeps the agent but
starts slowly, and scale-out only helps if new pods are ready quickly. The JDK's
ahead-of-time cache (Project Leyden, JDK 24 and later) stores loaded and linked
classes from a training run, and Spring Boot can stop a training run once its
context has refreshed.

## Decision

- **Always the JVM, always the agent.** The BFF runs on the pinned GraalVM JDK
  as a JVM, with the OpenTelemetry Java agent added by Jib and started with
  `-javaagent`. The agent is pinned by version and checksum.
- **Fast start from a build-time cache.** The build runs the application once
  as a training run, with the same JDK, flags, and agent and with non-secret
  configuration, stopping after the Spring context refreshes. The resulting
  AOT cache is added to the image as a Jib layer and used on every start,
  together with Spring's ahead-of-time processing.
- **Jib builds the image.** `kore` runs the Jib build instead of a Docker build
  for these services, and signs and deploys the digest Jib reports.
- **Native image leaves the golden path.** A service may still build a native
  image, with the OpenTelemetry Spring Boot starter in place of the agent,
  only as a recorded exception.
- **The budget is measured, not assumed.** The template records measured
  startup to readiness with the cache and agent. Until it meets the budget,
  autoscaling starts earlier and keeps at least two replicas
  ([ADR 0047](0047-autoscaling-metrics-server-then-keda.md)).

## Consequences

- No secret is present during the training run, so the cache holds none.
- The cache is valid only for the exact JDK, flags, and agent it was trained
  with; changing any of them rebuilds it, and a mismatch falls back to a normal,
  slower start rather than failing.
- Classes the agent transforms may be left out of the cache. How much of the
  startup gain survives with the agent is measured before the template becomes
  the default.
- Checkpoint and restore (CRaC) was not chosen: it needs a CRaC-enabled JDK
  rather than GraalVM, and its snapshot would capture whatever was in memory,
  secrets included.
