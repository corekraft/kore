---
status: accepted
summary: Keycloak holds people for the platform in one realm, with a Keycloak organization per tenant root and nested groups per sub-organization that the Organization API manages, so every tool reads membership from the token's groups.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0040: Hold human identity in Keycloak with groups mirroring organizations

Source: [`docs/vision.md` § The Portal: Backstage and Argo CD Out of the Box](../vision.md#the-portal-backstage-and-argo-cd-out-of-the-box)

## Context

The vision needs one identity provider for people across Backstage, Argo CD,
Grafana, and the business view, and every tool must agree on which
organizations a person belongs to. The candidates were Keycloak and Zitadel.
Neither nests organizations, so Kore's `Organization` model holds the tree
either way ([ADR 0038](0038-organization-hierarchy-depth-and-labels.md)), and
the identity provider only has to carry membership.

## Decision

- **Keycloak is the identity provider,** installed and upgraded as a platform
  component through its operator, with its database claimed through the
  PostgreSQL platform API.
- **One realm for the platform.** Each tenant root is a Keycloak organization
  in that realm.
- **Groups mirror organizations.** Each sub-organization is a nested group
  under its tenant's group, and tokens carry the user's groups.
- **The `Organization` API owns those groups and organizations,** through a
  Crossplane Keycloak provider, so membership has one owner and no one edits
  it in the Keycloak console.
- **Every tool reads the token.** Backstage, Argo CD, and Grafana sign users in
  through OIDC and scope access by the groups claim.

## Consequences

- Keycloak becomes a platform prerequisite for the portal and delivery tools,
  with readiness checks like every other component.
- Group names derive from organization identifiers, so renaming an organization
  never breaks access.
- A Crossplane Keycloak provider must be pinned and evaluated before
  implementation; `crossplane-contrib/provider-keycloak` is the candidate.
- Operator access stays a separate, platform-organization group.
