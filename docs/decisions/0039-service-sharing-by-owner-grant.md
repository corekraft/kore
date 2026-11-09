---
status: accepted
summary: Within a tenant a service is shared only by an explicit grant from its owner, which a parent organization can block but not force; across tenants only an operator can grant access.
date: 2026-11-08
last-verified: 2026-11-09
---

# ADR 0039: Share services by owner grant

Source: [`docs/vision.md` § Tenancy Model](../vision.md#tenancy-model)

## Context

Services in sibling organizations sometimes need each other, such as a shared
`auth` service in an umbrella of companies. The options were explicit grants by
the owning service, or policy set by a parent organization on its children's
behalf. Parent-driven sharing is convenient but takes control from the owner,
and the tenant root is the isolation boundary
([ADR 0037](0037-tenant-isolation-by-namespace.md)).

## Decision

- **Owner grants within a tenant.** A service is reachable by another service in
  the same tenant only when the owning service grants it, naming the grantee
  service.
- **Parents can block, not force.** A parent organization may forbid grants
  within its subtree. It cannot create a grant for a service it does not own.
- **Operators alone grant across tenants.** No tenant can grant access to a
  service or data in another tenant.
- **Grants compose into native policy.** A grant becomes an Istio authorization
  rule admitting the grantee's workload identity
  ([ADR 0007](0007-workload-identity-and-layered-authorization.md)), plus access
  in the data store when the shared resource is a topic, bucket, or database.

## Consequences

- Default-deny between services stays the baseline; every exception is a
  recorded grant.
- Revoking a grant removes the generated policy and data access; the grantee's
  calls fail closed.
- The portal shows grants on both the owner's and the grantee's services.
