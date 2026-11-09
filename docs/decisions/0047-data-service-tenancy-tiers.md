---
status: accepted
summary: PostgreSQL, document, and key-value claims each get their own instance; Kafka and the object store are shared per environment and partitioned by organization and service; a tenant root can get a dedicated Kafka cluster or object store when its administrators request it and an operator approves.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0047: Tier data services between per-claim instances, shared stores, and dedicated tenant stores

Source: [`docs/vision.md` § Data Services, Scoped to the Organization](../vision.md#data-services-scoped-to-the-organization)

## Context

Every data dependency is a claim scoped to its service's organization. Small
stores are cheap to run per claim, while a Kafka cluster or an object store is
expensive to run once per organization. The tenant root is the isolation
boundary ([ADR 0037](0037-tenant-isolation-by-namespace.md)), and dedicated
capacity is a cost and capacity decision.

## Decision

- **One instance per claim** for PostgreSQL, the document store, and the
  key-value store, as the PostgreSQL API already composes
  ([ADR 0008](0008-crossplane-postgresql-platform-api.md)).
- **Shared and partitioned** for Kafka and the object store. Each environment
  runs one Kafka cluster, where topics and users are prefixed by organization
  and service, with per-user ACLs and quotas. Each environment runs one object
  store, with a bucket per claim and an access policy per service.
- **Dedicated per tenant root.** A tenant root may get its own Kafka cluster or
  object store. Its administrators request it in the `Organization` resource,
  and an operator approves it. Sub-organizations do not get dedicated stores.
- **Quotas count everything.** Per-claim instances, shared partitions, and
  dedicated stores all count toward the owning organization's quotas.
- **Credentials stay per service** in every tier, and sharing is a grant
  ([ADR 0039](0039-service-sharing-by-owner-grant.md)).

## Consequences

- A noisy service in a shared tier is bounded by the store's own quotas, not by
  separate hardware; tenants that need more isolation move to the dedicated
  tier.
- Moving a tenant between tiers migrates its data and needs an export and
  restore path per capability, as PostgreSQL has
  ([ADR 0029](0029-local-export-and-restore.md)).
