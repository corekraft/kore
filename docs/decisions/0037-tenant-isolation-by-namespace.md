---
status: proposed
summary: Tenants share one cluster and are isolated per service environment namespace by mesh, network policy, quotas, and admission; Kore's tenancy API owns those namespaces, without Capsule, and a vCluster is a later dedicated tier.
date: 2026-11-08
last-verified: 2026-11-09
---

# ADR 0037: Isolate tenants by namespace in one shared cluster

Source: [`docs/vision.md` § Tenancy Model](../vision.md#tenancy-model)

Refines: [ADR 0025](0025-application-namespace-ambient-enrollment.md), once the
`Service` API exists.

## Context

The vision makes an organization one tenant of a shared platform and asks how
strongly tenants are separated. The candidates were a namespace per service
environment in one cluster, a tenant grouping operator such as Capsule, or a
virtual cluster (vCluster) per tenant. Tenants reach capabilities through
platform APIs, so they do not need their own CRDs or cluster-scoped rights.
ADR 0025 has `kore app up` own application namespaces today.

## Decision

- **One shared cluster, one namespace per service environment.** The
  `Service` API composes each namespace, labeled with its tenant and
  organization ([ADR 0038](0038-organization-hierarchy-depth-and-labels.md)).
- **Isolation is layered.** Traffic between tenants is denied by default by
  Istio authorization policy and Kubernetes network policy, with mutual TLS.
  Each namespace gets quotas and limit ranges, Gatekeeper constraints, and the
  restricted Pod Security level.
- **No Capsule.** Kore's `Organization` and `Service` APIs own tenant
  namespaces, RBAC, and quotas. A second tenancy operator would give those
  resources two owners.
- **vCluster is a later dedicated tier** for a tenant that needs its own CRDs
  or cluster-admin rights. It is not the default.

## Consequences

- Tenants cannot install CRDs or cluster-scoped resources; they use platform
  APIs.
- Namespace ownership moves from `kore app up` to the `Service` composition when
  that API lands, refining ADR 0025's owner without changing its ambient
  enrollment.
- A negative test must prove that one tenant can neither reach nor list another
  tenant's workloads before a second tenant is admitted.
- The dedicated tier needs its own ADR when a tenant first requires it.
