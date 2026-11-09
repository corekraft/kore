---
status: accepted
summary: Static frontends are served in the cluster by default from a pinned static-server image that contains the build and is signed and deployed by digest, on the same host as the service's BFF; GitHub Pages or object storage is a per-service escape hatch.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0044: Serve static frontends in the cluster as signed images

Source: [`docs/vision.md` § The Golden Path: Frontend, BFF, Data](../vision.md#the-golden-path-frontend-bff-data)

## Context

Frontends are static builds, and the vision lets each environment choose where
they are hosted. The candidates were GitHub Pages, object storage behind the
Gateway, and an in-cluster static server. A frontend on the same site as its
BFF lets the BFF keep sessions in host-only, `SameSite` cookies. Only images
are covered by signature admission
([ADR 0005](0005-release-automation-signed-image-trust.md)); files in a bucket
or on a static host are not.

## Decision

- **In-cluster by default, in every environment.** Each frontend release is an
  image built from a pinned, minimal static-server base with the build inside
  it, signed and deployed by digest like any other workload.
- **Same host as its BFF.** The Gateway serves the frontend at `/` and the BFF
  at `/api` on the service's host, such as `auth.apps.corekraft.ca`, so both
  share an origin, certificate, and telemetry.
- **Escape hatch per service.** A service may host its frontend on GitHub Pages
  or object storage instead, with its BFF at `api.<service host>`. The service
  records why, and accepts that its frontend files are outside image
  signature admission.

## Consequences

- Every frontend release goes through the same build, sign, and deploy path as
  a backend, and rolls back by digest.
- Frontends cost a small pod each; they scale with the same autoscaling defaults
  ([ADR 0046](0046-autoscaling-metrics-server-then-keda.md)).
- The static-server base image is pinned and recorded like other images.
