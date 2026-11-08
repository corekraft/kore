---
status: accepted
summary: The PostgreSQL API narrows Crossplane's Secret access, projects CloudNativePG health onto the composite, labels retained PVCs, and makes app down report retained data.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0016: Scope PostgreSQL API permissions, status, and retained-data discovery

Source: [`infra/plans/2-implementation.md` § Step 10](../../infra/plans/2-implementation.md)

Refines: [ADR 0008](0008-crossplane-postgresql-platform-api.md), [ADR 0003](0003-separate-claims-and-retain-data.md)

## Context

ADR 0008 left Crossplane with broad Secret permissions, readiness driven only by
`function-auto-ready`, and a retained-data query keyed on a label the
composition never put on PVCs.

## Decision

- Crossplane's Secret rule drops `update` and keeps `get`, `list`, `watch`,
  `create`, `patch`, `delete`; `clusters/status` is read-only. Kubernetes cannot
  restrict `create` by name, so the chart's `namespaces` value binds the role per
  namespace; empty means cluster-wide, since claims may live anywhere.
- A `project-status` pipeline step copies CloudNativePG phase, `phaseReason`, and
  the endpoint host/port onto the composite status and sets a `DatabaseHealthy`
  condition; failures surface instead of waiting forever on auto-ready.
- The `Cluster` sets `inheritedMetadata` so its PVCs carry
  `platform.kore.dev/retention` matching the retention policy.
- `kore app down` removes only the workload release, then lists retained
  resources in the application namespace and never deletes them.
- The composition contract is a spec, not prose.

## Consequences

The `ClaimConditions` output and the dropped `update` verb are unverified live;
the first live run must confirm Crossplane still composes and the condition
appears. The reference app still cannot authenticate to the database.
