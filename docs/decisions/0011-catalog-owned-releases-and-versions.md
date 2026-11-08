---
status: accepted
summary: The repository catalog declares every release, namespace, single owner, CRD owner, dependency, readiness check, and pinned version; orchestration derives its order from it.
date: 2026-09-12
last-verified: 2026-11-07
---

# ADR 0011: Declare releases, ownership, and versions in the catalog

Source: [`infra/plans/1-initialize.md` § Release Catalog](../../infra/plans/1-initialize.md#release-catalog),
[§ Resource Ownership](../../infra/plans/1-initialize.md#resource-ownership), and
[§ Version Catalog](../../infra/plans/1-initialize.md#version-catalog)

## Context

Component lists and versions hidden in imperative scripts drift, and two
releases rendering the same resource fight over it. CRDs are cluster-wide APIs
whose removal destroys every instance.

## Decision

- `infra/catalog/components.yaml` is the source of truth for logical
  releases, namespaces, dependencies, timeouts, readiness checks, and upstream
  chart locations. `kore platform up` derives its execution order from it.
- Dependencies form an acyclic graph; independent branches may run in
  parallel.
- Every cluster-scoped resource, CRD, and namespaced object has exactly one
  declared owner. A controller's release owns its CRDs unless the upstream
  project needs a separate CRD release, which the catalog records.
  `kore-platform-config` owns shared configuration instances, never controller
  CRDs or Deployments. Application resource releases own only their claims.
- CRD removal is never an implicit consequence of an ordinary uninstall.
- `infra/catalog/versions.yaml` records every version used. Floating versions
  are prohibited; digests and checksums are recorded where supported; native
  Helm and OpenTofu lock files stay. A version change updates the compatibility
  matrix and passes the reference application.

## Consequences

Ordering, ownership, and upgrades are reviewable in the repository. Adding a
component means adding a catalog entry with an owner, readiness checks, and a
pinned version; the `pin-upgrade` skill covers the upgrade path.
