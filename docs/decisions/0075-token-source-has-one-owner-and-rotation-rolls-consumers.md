---
status: accepted
summary: The cluster's reference API token source is created once and never overwritten by another checkout; only `kore secrets sync --rotate --yes` replaces it, and a one-way rotation marker in the workload's pod template restarts consumers.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0075: One owner for the token source; rotation rolls consumers

Refines: [ADR 0009](0009-encrypted-secrets-through-external-secrets.md) (secrets
reach applications through External Secrets).

## Context

Kore generated the reference API token into each checkout's local state and
applied it as the External Secrets source on every sync. Two checkouts sharing
the `kore-local` profile each hold a different token, so `kore local up` from the
second replaced the source. External Secrets re-synced the target Secret, but a
Secret consumed as an environment variable is read only at container start, so
the running API kept the old value and the protected route returned 403 for the
cluster's current token.

## Decision

- **Create if absent.** `kore secrets sync` (and so `kore local up`) applies the
  token source only when it does not exist in the cluster. An existing source is
  never overwritten, whatever the checkout's local state holds, and a checkout
  with no local token does not generate one.
- **Rotation is explicit.** `kore secrets sync --rotate --yes` generates a new
  token, stores it in local state, and replaces the source. Without `--yes` it
  fails before running anything.
- **Rotation rolls consumers.** Every write of the source records a random
  `platform.kore.dev/rotation-id` annotation. `kore app up` reads that annotation
  (never secret data), digests it, and passes the first 16 hex characters as the
  chart value `secretVersion`; the workload chart puts it in the pod template as
  `platform.kore.dev/secret-version`. A new rotation changes the template, so the
  Deployment rolls onto the new value. The chart does not know about External
  Secrets, and a source without the annotation adds no marker.
- **The Secret is current before the pods roll.** The source also records
  `platform.kore.dev/rotated-at`. Before `kore app up` passes a `secretVersion`,
  it checks the ExternalSecret (`<app>-app`) in the app namespace: if it is not
  Ready or its `status.refreshTime` is not after the rotation, kore sets the
  `force-sync` annotation on it (kore owns that, not the chart) and waits,
  bounded to two minutes, for Ready with a later refresh. The wait reads only
  annotations and status, never Secret data. On timeout it fails naming the
  ExternalSecret and its Ready condition, reason and refresh time. A Secret
  already refreshed after the rotation is not resynced.

## Consequences

- A checkout whose local token differs from the cluster's no longer changes the
  cluster; the cluster's token is the truth. To recover a cluster already out of
  step, run `kore secrets sync --rotate --yes` then `kore local up`.
- Rotation completes on `kore app up`/`kore local up`; the rotate command tells
  the operator so. The pods never restart before the materialized Secret holds
  the new value, so no manual rerun is needed; a Secret that cannot sync fails
  the run with the ExternalSecret's condition instead of rolling pods onto a
  stale value.
- Needs a live run (two checkouts: up from A, up from B, protected route answers
  200 with the cluster token) before this is considered proven.
