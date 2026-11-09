---
status: accepted
summary: A catalog component can claim the API groups whose CRDs its controller installs at runtime (`ownsCRDGroups`); validation rejects overlapping claims offline, and `kore platform status` reports cluster CRDs with no owner or several as degraded, in audit mode only.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0057: Own runtime-installed CRDs by API group, and audit them in status

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md#step-7-bootstrap-registry-image-trust-controllers-and-crd-ownership)

Refines: [ADR 0011](0011-catalog-owned-releases-and-versions.md) (CRD
ownership by `ownsCRDs`, which only covers names a chart renders or kore
waits for).

## Context

`ownsCRDs` lists names, and `npm run test:upstream-charts` proves every CRD a
pinned chart renders is declared once. Controllers also create CRDs at runtime:
Crossplane installs its `pkg`, `apiextensions`, `ops`, `protection`, and
`secrets` CRDs from its init container and Function packages ship input CRDs
(`gotemplates.gotemplating.fn.crossplane.io`); Gatekeeper generates a
`<kind>.constraints.gatekeeper.sh` CRD per constraint template. No chart
renders these, so nothing checked who owns them, and a stray or doubly claimed
CRD went unnoticed.

## Decision

- A component may declare `ownsCRDGroups`, a list of API groups (for example
  `pkg.crossplane.io`). It claims every CRD in exactly that group, not its
  subdomains. Exact `ownsCRDs` names stay for CRDs the catalog waits on.
- `kore validate` fails offline when two components claim one group, when a
  component names a CRD inside a group another component claims, or when a
  claim is not a valid group. A component may name CRDs inside its own group.
- `kore platform status` adds a platform-wide `crd-ownership` row, like the
  admission gate row. It lists cluster CRDs through the runner (`kubectl
--context <configured> get crd --output json`, read-only) and marks the row
  degraded for any CRD with no owner or more than one. `--json` carries
  `crds: { total, unowned, multiple }`. An unreadable list is `missing`, not
  clean. A filtered `status` omits the row.
- Catalog claims: `crossplane` owns its five core groups,
  `kore-crossplane-functions` owns `gotemplating.fn.crossplane.io`, and
  `kore-policy-templates` owns `constraints.gatekeeper.sh`.

**Audit before enforce.** The row never fails `platform up`: it is reported
only. Promotion to a bootstrap failure waits for a clean live audit on a fresh
profile and a managed cluster, then is its own decision.

## Consequences

- Adding a provider or Function package that installs CRDs requires a group
  claim in the catalog; until then status reports its CRDs as unowned.
- A coarse group claim cannot tell which of a component's CRDs it truly owns;
  that remains the job of exact `ownsCRDs` plus the chart check.
- Not yet proven live: the `crd-ownership` row on a real cluster (no cluster
  was touched).
