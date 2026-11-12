---
status: accepted
summary: An environment overlay can declare `providerOwnedCRDGroups` (group to reason); `crd-ownership` counts CRDs in those groups as owned by the provider and lists them as `providerOwned`, so k3d's k3s CRDs no longer degrade the row. A group a component also owns is rejected.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0088: Environments declare the CRD groups their provider owns

Source: [`infra/plans/9-k3d-local-cluster.md`](../../infra/plans/9-k3d-local-cluster.md)

Refines: [ADR 0057](0057-runtime-crd-ownership.md) (CRD ownership audit, which
knew only catalog owners).

## Context

k3s ships CRDs (`addons.k3s.cattle.io`, `etcdsnapshotfiles.k3s.cattle.io`,
`helmcharts.helm.cattle.io`, `helmchartconfigs.helm.cattle.io`) that no catalog
component owns, so on k3d the `crd-ownership` row was degraded. Claiming them in
a component would give Kore ownership of something k3s reconciles.

## Decision

- An environment may declare `providerOwnedCRDGroups`, a map of API group to the
  reason the provider owns it. It is schema-checked (`infra/environments/schema.json`)
  and validated offline: each key is an API group, each reason is non-blank, and a
  group a catalog component owns (by `ownsCRDs` or `ownsCRDGroups`) is rejected.
  Apps are unaffected.
- Declarations are tied to the provider. Code keeps an allowlist of the groups
  each provider ships (k3d: `k3s.cattle.io`, `helm.cattle.io`; minikube and
  managed: none). Validation refuses any other group and tells the user to
  claim it in a catalog component with `ownsCRDGroups` instead, so an overlay
  cannot hand Kore-installed CRDs (for example `monitoring.coreos.com`) to a
  provider that does not own them. A value that is not a map of group to reason
  is refused too.
- The local k3d overlay declares `k3s.cattle.io` and `helm.cattle.io`.
- `crd-ownership` counts a CRD in a declared group as owned by the provider, not
  unowned. `--json` carries `crds.providerOwned`, and the ready detail says how
  many CRDs are catalog-owned and provider-owned. A CRD in an undeclared group
  stays unowned.

## Consequences

One owner per resource still holds: the owner is k3s, not Kore. Minikube and
managed overlays declare nothing and behave as before.
