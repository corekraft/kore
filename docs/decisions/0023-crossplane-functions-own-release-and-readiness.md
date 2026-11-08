---
status: accepted
summary: Crossplane composition Functions are their own catalog release between crossplane and kore-postgresql-api, and a function readiness kind waits for each to be Installed and Healthy.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0023: Crossplane Functions are their own release with readiness checks

Source: [`infra/plans/2-implementation.md`](../../infra/plans/2-implementation.md) (Step 7)

Refines [ADR 0008](0008-crossplane-postgresql-platform-api.md) and
[ADR 0016](0016-release-readiness-checks-drive-wait-and-status.md).

## Context

`function-go-templating` and `function-auto-ready` were applied inside the
`kore-postgresql-api` manifest. That release's only readiness check was the
claim CRD, so nothing proved the Function packages were pulled and running
before compositions depended on them. Two resource kinds were also owned by
one release that is about the database API.

## Decision

- A `kore-crossplane-functions` manifest release (`infra/apis/crossplane-functions`)
  owns the Function packages. It depends on `crossplane`, and
  `kore-postgresql-api` depends on it.
- `readiness.ts` gains a `function.pkg.crossplane.io/` kind. It waits for
  `Installed`, then `Healthy`, each bounded by the component timeout, retrying
  while the Function does not exist yet. Failures read
  `<resource> not ready (Installed and Healthy) within <timeout>: <cause>`.
  Rollout status cannot express this: a Function is a package resource, not a
  workload.
- The CRD wait and the Function wait share one condition-wait helper.

## Consequences

- Function versions stay pinned in one file; adding a Function means adding it
  and its readiness entry to that release.
- A broken package pull fails the Functions release instead of surfacing later
  as a composition error.
