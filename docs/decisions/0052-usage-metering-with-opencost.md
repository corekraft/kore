---
status: proposed
summary: Usage is metered per organization for visibility, with OpenCost allocating compute and storage by namespace labels plus data claims and telemetry volume, rolled up the organization tree into the business view; enforcement stays with quotas, and there is no billing.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0052: Meter usage per organization with OpenCost, for visibility

Source: [`docs/vision.md` § The Portal: Backstage and Argo CD Out of the Box](../vision.md#the-portal-backstage-and-argo-cd-out-of-the-box)

## Context

Organization administrators want to see what their services use and cost.
Quotas already bound what an organization can consume
([ADR 0037](0037-tenant-isolation-by-namespace.md),
[ADR 0048](0048-data-service-tenancy-tiers.md)). Kore must not reimplement
cost allocation that an upstream tool already does.

## Decision

- **OpenCost allocates compute and storage** by the tenant and organization
  namespace labels ([ADR 0038](0038-organization-hierarchy-depth-and-labels.md)).
- **Metered per organization:** CPU and memory requests, persistent storage,
  data claims by type and tier, and telemetry ingestion.
- **Rolled up the tree.** Each organization sees its own usage and its
  descendants', in the Backstage business view.
- **Visibility only.** Enforcement stays with quotas; there is no billing or
  charging.

## Consequences

- OpenCost enters the catalog as an observability release with its own
  readiness checks.
- Cost figures use the environment's pricing; local figures are relative, not
  money.
- Billing, if it is ever needed, gets its own ADR.
