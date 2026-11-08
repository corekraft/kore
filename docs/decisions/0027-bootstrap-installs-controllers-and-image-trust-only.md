---
status: accepted
summary: kore platform bootstrap installs only controllers and image trust; the shared PostgreSQL API and the OPA authorizer move to the configuration phase.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0027: Bootstrap installs controllers and image trust only

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md) (exit criterion and 2026-11-08 decision 1)

Refines: [ADR 0004](0004-fail-closed-application-admission-gate.md) (phased bootstrap), [ADR 0008](0008-crossplane-postgresql-platform-api.md) (PostgreSQL API), [ADR 0014](0014-native-identity-before-opa.md) (OPA authorizer).

## Context

Step 7 requires that bootstrap installs no shared issuer, gateway, composition,
secret store, or unrelated enforcing policy; image signature enforcement is the
only exception. `kore platform bootstrap` runs every phase before
`configuration`, and the `core` phase still held `kore-postgresql-api` (the
shared XRD and Composition) and `opa-authorizer` (a fail-closed ExtAuthz
backend). Both are shared platform configuration, not controllers.

## Decision

- **`kore-postgresql-api` and `opa-authorizer` are `configuration` phase.**
  Bootstrap now installs controllers (Crossplane, its Functions, CloudNativePG,
  cert-manager, External Secrets, Istio, Gatekeeper, the Policy Controller) and
  image trust. `platform up` and `local up` run the configuration phase straight
  after, so the full install order is unchanged in effect.
- **Dependencies are unchanged.** Both still depend on controllers in earlier
  phases; `kore-platform-config` already depended on both. The istiod
  `opa-authorizer` extension provider is mesh configuration only; nothing calls
  it until the authorizer's own `AuthorizationPolicy` is applied in the
  configuration phase.
- **`kore-postgresql-rbac` and `kore-crossplane-functions` stay in `core`.**
  A scoped ClusterRole and Function packages are controller-side prerequisites
  that define no XRD, Composition, or policy, so they do not violate the
  criterion.
- **A test guards the boundary.** The bootstrap spec asserts that no bootstrap
  component installs the PostgreSQL API, the OPA authorizer, platform
  certificate or configuration, or names a shared issuer, gateway, or secret
  store in its readiness checks.

## Consequences

- Bootstrap alone leaves no shared API or authorizer behind, matching the exit
  criterion; the Platform Bootstrap Completion Gate is unaffected.
- `platform status` still lists both components, now under configuration.
