---
status: accepted
summary: The platform organization gets its own Backstage and Argo CD for operators in Next: Argo CD syncs service workloads from git by digest while image admission decides what runs, and Backstage reads clusters as the user through OIDC.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0111: Run a Backstage and an Argo CD for the platform organization's operators

Source: [`infra/plans/15-next-horizon.md` § Step 1](../../infra/plans/15-next-horizon.md#step-1-accept-the-next-adrs)

Refines: ADR 0041

## Context

[ADR 0041](0041-backstage-and-argo-cd-per-tenant.md) mixes two horizons. Its
per-tenant Backstage and Argo CD need the tenancy model, so they arrive in Then.
Its platform-organization set needs none: in Next only the platform
organization exists, and operators still need a portal and git delivery
([plan 15](../../infra/plans/15-next-horizon.md)). The split lets Next accept
its part without accepting tenant tooling that has no tenant to serve, as was
done for [ADR 0113](0113-run-a-keycloak-for-the-platform-organization-s-operators.md) and
[ADR 0114](0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md).

## Decision

- **The platform organization gets its own Backstage and Argo CD** for
  operators.
- **Argo CD syncs service workloads from git, by digest.** Image admission
  still decides what runs.
- **Backstage reads clusters as the user.** Its Kubernetes plugin uses the
  user's OIDC token ([ADR 0113](0113-run-a-keycloak-for-the-platform-organization-s-operators.md)), so
  Kubernetes RBAC applies.
- **Both run like any other service,** with hosts, a claim on the PostgreSQL
  API and telemetry.

ADR 0041 keeps the per-tenant clauses, which stay in Then.

## Consequences

- Next's footprint counts a Backstage and an Argo CD for the platform
  organization.
- Operators get a portal and git delivery before any tenant exists.
- ADR 0041's per-tenant design builds on this one rather than replacing it.
