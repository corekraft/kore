---
status: accepted
summary: Each tenant root gets its own Backstage and its own namespace-scoped Argo CD, composed by the Organization API, scoped inside by sub-organization groups; Argo CD owns that tenant's service workload releases.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0041: Run one Backstage and one Argo CD per tenant

Source: [`docs/vision.md` § The Portal: Backstage and Argo CD Out of the Box](../vision.md#the-portal-backstage-and-argo-cd-out-of-the-box)

Refines: [ADR 0002](0002-tool-responsibility-boundaries.md) and
[ADR 0011](0011-catalog-owned-releases-and-versions.md), for tenant service
workloads only.

## Context

The vision ships Backstage and Argo CD out of the box. A single shared
Backstage relies on each plugin to enforce access, and plugins that call other
systems with platform credentials can leak data between tenants. A single
shared Argo CD would hold deploy rights to every tenant's namespaces. Today Helm
and the catalog own every release (ADR 0002, ADR 0011), and Plan 1 deferred
GitOps.

## Decision

- **One Backstage and one Argo CD per tenant root.** The `Organization` API
  composes both when it creates a tenant root, in a platform namespace for that
  tenant. The platform organization gets its own pair for operators.
- **Scoped inside by organization.** Backstage permission policies and Argo CD
  RBAC key on the sub-organization groups in the token
  ([ADR 0040](0040-keycloak-human-identity.md)). Argo CD has an AppProject per
  organization that limits source repositories, destination namespaces, and
  resource kinds.
- **Argo CD is namespace-scoped.** Each instance can deploy only into its
  tenant's service namespaces and cannot touch another tenant or cluster-scoped
  resources ([ADR 0037](0037-tenant-isolation-by-namespace.md)).
- **Argo CD owns tenant service workloads.** It syncs each service
  environment's workload from git, by digest; image admission still decides
  what runs. Platform components stay with bootstrap, Helm, and the catalog.
- **Backstage reads clusters as the user.** Its Kubernetes plugin uses the
  user's OIDC token so Kubernetes RBAC applies. A plugin that calls another
  system with shared credentials is enabled only once it is scoped to the
  tenant.
- **They run like any other service.** Each instance gets hosts under the
  tenant's service base, such as `backstage.apps.corekraft.ca`, claims its
  database through the PostgreSQL API, and counts toward the tenant's quotas.

## Consequences

- Every tenant pays for a Backstage and an Argo CD; sizing and quotas must
  account for them.
- `backstage` and `argocd` become reserved service names in a tenant's base.
- Operators do not see tenant catalogs from the platform Backstage; they use
  the model and `kore`.
- Whether an Argo CD instance also takes over platform components after
  bootstrap stays open in the vision.
- Upgrading Backstage and Argo CD means rolling every tenant's instance, so the
  composition pins one version for all of them.
