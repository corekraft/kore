---
status: accepted
summary: Each tenant root gets its own Keycloak, composed by the Organization API, with one realm and nested groups per sub-organization, so that tenant's tools read membership from tokens its Keycloak issues.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0040: Give each tenant its own Keycloak with groups mirroring organizations

Source: [`docs/vision.md` § The Portal: Backstage and Argo CD Out of the Box](../vision.md#the-portal-backstage-and-argo-cd-out-of-the-box)

## Context

The vision needs an identity provider for people across Backstage, Argo CD,
Grafana, and the business view, and every tool must agree on which
organizations a person belongs to. The candidates were Keycloak and Zitadel.
Neither nests organizations, so Kore's `Organization` model holds the tree
either way ([ADR 0038](0038-organization-hierarchy-depth-and-labels.md)), and
the identity provider only has to carry membership. Backstage and Argo CD run
per tenant ([ADR 0041](0041-backstage-and-argo-cd-per-tenant.md)), and identity
follows the same boundary.

## Decision

- **Keycloak, one instance per tenant root.** The `Organization` API composes a
  Keycloak for each tenant root through the Keycloak operator, which the
  platform installs once. Each instance claims its database through the
  PostgreSQL platform API, gets a host under the tenant's service base, and
  counts toward the tenant's quotas. The platform organization has its own
  Keycloak for operators.
- **One realm per instance.** Groups mirror organizations: each
  sub-organization is a nested group, and tokens carry the user's groups.
- **The `Organization` API owns the realm's organizations and groups,**
  through a Crossplane Keycloak provider, so membership has one owner and no
  one edits it in the Keycloak console.
- **Tenants can bring their own login.** A tenant's administrators may broker
  an external identity provider, such as Google Workspace or Microsoft Entra
  ID, into their realm without affecting other tenants.
- **Each tenant's tools trust only their tenant's issuer.** The tenant's
  Backstage, Argo CD, and Grafana access sign users in through OIDC against
  that tenant's Keycloak and scope access by the groups claim.

## Consequences

- Every tenant pays for a Keycloak alongside its Backstage and Argo CD, and
  upgrades roll through every instance at one pinned version.
- A person in two tenants has two accounts unless a tenant brokers a shared
  external identity provider.
- Backstage reading clusters as the user needs the Kubernetes API server to
  trust every tenant's issuer through structured authentication configuration,
  with usernames and groups prefixed by tenant so they cannot collide. That is
  a cluster setting, so it lives in environment overlays.
- `keycloak` becomes a reserved service name in a tenant's base.
- A Crossplane Keycloak provider must be pinned and evaluated before
  implementation; `crossplane-contrib/provider-keycloak` is the candidate.
