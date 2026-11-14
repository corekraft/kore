---
status: accepted
summary: The platform organization gets its own Keycloak in Next, with one realm and nested groups mirroring organizations, so the portal has a sign-in before any tenant exists.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0113: Run a Keycloak for the platform organization's operators

Source: [`infra/plans/15-next-horizon.md` § Step 1](../../infra/plans/15-next-horizon.md#step-1-accept-the-next-adrs)

Refines: ADR 0040

## Context

[ADR 0040](0040-keycloak-human-identity.md) mixes two horizons. A Keycloak per
tenant root needs the tenancy model, so it arrives in Then. The platform
organization's own Keycloak needs none: in Next only the platform organization
exists, and the portal needs a sign-in before any tenant does
([plan 15](../../infra/plans/15-next-horizon.md)). The split lets Next accept
its part without accepting tenant tooling that has no tenant to serve, as was
done for [ADR 0111](0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md)
and [ADR 0114](0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md).

## Decision

- **The platform organization gets its own Keycloak** for operators, installed
  through the Keycloak operator the platform installs once. It claims its
  database through the PostgreSQL platform API and gets a host under the
  platform base.
- **One realm, with groups mirroring organizations.** Each sub-organization is
  a nested group, and tokens carry the user's groups.
- **The `Organization` API owns the realm's organizations and groups,** through
  a Crossplane Keycloak provider, so membership has one owner.
- **The platform's tools trust only this issuer.** The platform Backstage, Argo
  CD and Grafana sign users in through OIDC against it and scope access by the
  groups claim.

ADR 0040 keeps the per-tenant clauses, which stay in Then.

## Consequences

- Next's footprint counts a Keycloak and its database for the platform
  organization.
- Operators get a sign-in before any tenant exists.
- ADR 0040's per-tenant design builds on this one rather than replacing it.
