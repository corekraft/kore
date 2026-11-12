---
status: accepted
summary: A resources-only release that holds a WaitForFirstConsumer claim sets helm.wait false so Helm does not wait for the bind; the consumer's own readiness check proves the volume.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0086: Resources-only releases do not wait on claims that bind later

Source: [`infra/plans/9-k3d-local-cluster.md` § Step 5](../../infra/plans/9-k3d-local-cluster.md#step-5-storage)

Refines: [ADR 0061](0061-retained-volumes-are-discovered-by-storage-class.md), [ADR 0035](0035-fail-fast-readiness-diagnosis.md) (the volume is proven by the consumer's readiness check, not by Helm's wait).

## Context

The k3s local-path provisioner cannot bind a claim without a node, so the
storage classes use `WaitForFirstConsumer` (live run 1). A claim then stays
Pending until a pod uses it. The Tempo claim lives in `kore-observability-config`,
apart from the Tempo workload, so that retained data survives a Tempo uninstall
(ADR 0061). Helm's `--wait` treats a Pending claim as not ready, so the config
release timed out on every first run.

## Decision

The claim stays in the config release. A catalog component may set
`helm: {wait: false, reason}`; `helmUpgradeArgs` then passes `--wait=hookOnly`,
so Helm waits for hooks only. It omits `--rollback-on-failure` for that
component, because Helm 4 turns that flag back into a resource wait (seen live);
a failed release is recovered by the existing failed-release handling. Only
`kore-observability-config` sets it. Tempo keeps its normal wait and its
`statefulset/tempo` readiness check, which cannot pass until the volume binds,
so the volume is still proven before the platform is ready.

## Consequences

- Any other resources-only release that holds a `WaitForFirstConsumer` claim
  must opt out the same way; the reason is required by the schema and by
  validation.
- The opt-out changes the desired-state fingerprint, so an existing profile
  reconciles the release once.
- The config release is no longer proven by Helm alone: its own readiness list
  covers its ConfigMaps, and Tempo covers the claim.
