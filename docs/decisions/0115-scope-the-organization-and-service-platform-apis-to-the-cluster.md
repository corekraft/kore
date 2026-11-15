---
status: accepted
summary: Organization and Service are cluster-scoped Crossplane v2 APIs because their namespace composition must create cluster-scoped Namespace objects, which a namespaced composite resource cannot compose.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0115: Scope the Organization and Service platform APIs to the cluster

Source: [`infra/plans/15-next-horizon.md` § Step 2](../../infra/plans/15-next-horizon.md#step-2-organization-and-service-platform-apis)

Refines: ADR 0008

## Context

[ADR 0008](0008-crossplane-postgresql-platform-api.md) defines the PostgreSQL
platform API as namespaced, and plan 15 Step 2 says to follow its layout. The
`Organization` and `Service` APIs cannot. Each `Service` environment gets a
namespace with tenant and organization labels
([ADR 0037](0037-tenant-isolation-by-namespace.md)), and `Namespace` is a
cluster-scoped Kubernetes kind. In Crossplane v2 (pinned at 2.4.3) a
`Namespaced` composite resource can only compose resources in its own
namespace; only a `Cluster` one can compose at cluster scope.

## Decision

- `Organization` and `Service` XRDs use `scope: Cluster`, not `Namespaced`.
- Everything else follows ADR 0008's layout: `platform.kore.dev` group, portable
  inputs, one composition per environment.
- `PostgreSQLInstance` stays namespaced; it composes only namespaced resources.

## Consequences

- The later namespace composition can create the labelled `Namespace` objects.
- Creating an `Organization` or `Service` needs cluster-scoped rights, so only
  platform operators hold them; tenants reach them through the portal and
  delivery, not by direct access.
- If Crossplane lets a namespaced composite resource compose cluster-scoped
  kinds, revisit this decision.
