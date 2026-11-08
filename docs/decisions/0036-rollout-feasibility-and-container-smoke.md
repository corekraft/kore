---
status: accepted
summary: Two opt-in offline-ish checks catch cluster-facing failures before first live contact. A rollout-feasibility check flags workloads that cannot roll out or drain on the environment's node count; a container smoke runs each kore-owned chart's pinned image under docker and rejects crashes and bind errors.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0036: Rollout feasibility and container smoke before live contact

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md)

## Context

Two live failures were visible without a cluster. The oci-registry chart set
`REGISTRY_HTTP_ADDR=127.0.0.1:5001`, but registry:3's stock config already runs
its debug server on `:5001`, so the container crash-looped with `address already
in use`. The loki chart's gateway has a required hostname `podAntiAffinity`
against its own pods and a RollingUpdate, so on the one-node local environment
the surge pod could never schedule.

## Decision

- **Rollout feasibility** (`rolloutProblems`, pure and unit-tested with
  fixtures including the loki gateway). The opt-in spec renders every chart
  component with the environment's values (`helmTemplateArgs`) and flags a
  Deployment, StatefulSet or DaemonSet whose peak pod count (replicas plus
  surge) exceeds the node count while pods need their own node (required
  hostname anti-affinity against themselves, or a `hostPort`), a DaemonSet that
  surges onto a `hostPort`, and a PodDisruptionBudget whose `minAvailable`
  covers every replica. It also flags the symmetric case: the running pods'
  required anti-affinity rejects a surge pod even when the new template drops
  the rule. The opt-in spec models the running release by rendering each
  upstream chart with the environment's scheduling keys (`affinity`, rollout
  strategies) removed. The environment schema declares no node count, so local
  is treated as one node. It runs in `npm run test:upstream-charts`.
- **Container smoke** (`classifySmokeLogs`, `smokeTargets`, `dockerRunArgs`,
  pure and unit-tested). The opt-in spec, `npm run test:container-smoke`, runs
  each container of a kore-owned local chart under docker by digest with its
  rendered env and args, read-only, and requires it to stay up about five
  seconds with no `address already in use` or fatal log line. Containers that
  need cluster resources (Secret, ConfigMap or projected volumes, `valueFrom`
  env) are skipped with a printed reason. The container is not started with
  `--rm`, so a crash keeps its logs; it is removed afterwards.
- Both are opt-in (they need helm and yq, or docker and image pulls) and never
  run in ordinary test runs.

## Consequences

- Local values disable the
  policy-controller webhook PodDisruptionBudget (one replica, one node). The loki gateway fix (affinity null with `maxSurge 0`) landed separately.
- Run both checks when adding or changing a chart or its local values.
