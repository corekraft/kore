---
status: accepted
summary: Every runtime image Kore builds or templates is distroless, with no shell and no package manager; builder stages are free, and upstream images we only pull are exempt but prefer distroless variants.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0116: Application runtime images are distroless; builder stages can be anything

Source: [`infra/plans/15-next-horizon.md` § Step 4](../../infra/plans/15-next-horizon.md#step-4-golden-path-templates) and [§ Step 6](../../infra/plans/15-next-horizon.md#step-6-platform-keycloak-and-backstage)

Refines: [ADR 0045](0045-static-frontends-as-signed-images.md) and [ADR 0046](0046-bff-jvm-with-agent-and-aot-cache.md)

## Context

The owner decided on 2026-11-14: "I think app images should start with a
distroless version", then "or wait. builders can be anything. but the
application runtime needs to be distroless".

The images Kore builds or templates today run on general-purpose bases:

- `apps/reference/Dockerfile`: `node:26.13.0-alpine3.24`, `USER 1000`.
- `templates/static-frontend/Dockerfile`: `nginxinc/nginx-unprivileged`
  (alpine), chosen in [ADR 0045](0045-static-frontends-as-signed-images.md).
- `templates/kotlin-bff`: Jib on the GraalVM JDK base, chosen in
  [ADR 0046](0046-bff-jvm-with-agent-and-aot-cache.md).
- The platform Backstage image (Step 6, in flight): its writer was told to make
  the runtime stage distroless.

Platform images such as oauth2-proxy are pulled from upstream and mirrored, not
built by Kore.

A shell and a package manager in a runtime image add attack surface and
vulnerability-scan noise that the application never uses. ADRs 0045 and 0046
picked their bases for what they ran, not for what they left out.

## Decision

**Application runtime images are distroless. Builder stages can be anything.**

- **Scope.** The rule covers every image Kore builds or templates: the
  reference app, the golden-path templates and the platform's own built images,
  Backstage included. Upstream images Kore only pulls and mirrors are exempt,
  but a distroless variant is preferred whenever upstream publishes one.
- **What counts as distroless.** A runtime image with no shell and no package
  manager, pinned by digest and verifiable with cosign. That includes
  `distroless/static`, `base`, and the `java` and `node` variants, and
  chainguard-style minimal images that meet the same test. A base that fails
  any part of the test does not count.
- **Builder stages are free.** Compile, bundle and train in any image; only
  the final runtime stage is held to the rule. The Jib base counts as the
  runtime stage.
- **Exceptions** are recorded, narrow and temporary: an issue names the image,
  the reason distroless cannot work, and what would end the exception, and the
  image's Dockerfile or build file links it. An exception needs the owner's
  approval and is reviewed when the base or the blocker changes.

This refines ADR 0045 (the static-server base must be distroless-compatible,
and signed-image delivery is unchanged) and ADR 0046 (the JVM, agent and AOT
cache stay; only the Jib base moves to a distroless Java runtime that can load
the AOT cache). Both chose their bases before this rule existed, so neither
decision changes beyond the base image.

## Consequences

- **Debug story.** A running container has no shell to exec into. Debug with an
  ephemeral container: `kubectl debug` attaches a tooling image to the pod,
  sharing its process namespace, in the configured context of the environment.
  Runbooks and docs say so.
- **Smaller surface.** Fewer packages to scan, patch and explain, so fewer
  findings against the runtime image.
- **Health checks and entrypoints** cannot use a shell. Probes use HTTP or
  gRPC, and the entrypoint is an exec-form command. Anything that relied on a
  shell script moves into the builder stage or the application.
- **A base-image change is cluster-facing.** Each migration below needs its own
  PR with a safety pattern (`expand-contract` or `feature-flagged`), and a live
  run before its flag turns on. This ADR changes no Dockerfile or image pin.
- **Pinned and signed.** Distroless bases are pinned by digest and recorded in
  the approved-images catalog like any other image.

### Follow-up migrations

| Image                            | Today                          | Target runtime                                | Pattern                                         |
| -------------------------------- | ------------------------------ | --------------------------------------------- | ----------------------------------------------- |
| Reference app (`apps/reference`) | `node:26.13.0-alpine3.24`      | distroless Node variant                       | `expand-contract`: its own PR                   |
| Static-frontend template         | `nginx-unprivileged` on alpine | distroless-compatible static server           | `expand-contract`: its own PR; refines ADR 0045 |
| Kotlin BFF template (Jib)        | GraalVM JDK base               | distroless Java base that loads the AOT cache | `expand-contract`: its own PR; refines ADR 0046 |
| Platform Backstage (PR #695)     | runtime stage in flight        | distroless Node runtime                       | checked in that PR's review                     |
