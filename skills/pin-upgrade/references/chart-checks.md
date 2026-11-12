# Chart bump checks

Detail for steps 5 and 6 of the `pin-upgrade` skill.

## Upstream chart check

Run `npm --prefix tools/kore run test:upstream-charts` for every chart bump (needs network; it renders each pinned helm chart).

- **CRD ownership.** Every CRD a chart installs must be declared in that component's `ownsCRDs` exactly once. Add new CRDs to the catalog and drop removed ones.
- **Injected images.** For `cloudnative-pg`, or any chart whose controller injects images into application namespaces, it checks the injected images. If that fails, update `upstreamImages` in `infra/charts/image-policy/values.yaml` to the new image repository (ADR 0032). Never widen a glob.
- **Probe patches** ([ADR 0089](../../../docs/decisions/0089-declarative-probe-patches-through-a-helm-post-renderer.md)). A component with catalog `patches` is rendered through the real `kore-patch` post-renderer, and `probe-patch-upstream.spec.ts` asserts the patched probes. If it fails with "patch target ... not found" or "is written in flow style", the chart moved or renamed the workload, container or probe: update the patch target, or drop the patch if the chart now exposes a probe value. Re-check each patch `reason` against the new chart.
- **Rollout feasibility** ([ADR 0036](../../../docs/decisions/0036-rollout-feasibility-and-container-smoke.md)). Every Deployment, StatefulSet and DaemonSet rendered with the local values must be able to roll out and drain on one node. It flags required hostname anti-affinity with surge, an old pod's anti-affinity rejecting the surge pod, `hostPort` collisions, and PodDisruptionBudgets that block drains. Fix a failure with a local values override (for example `gateway.affinity: null`), never by weakening the check.

## Container smoke

When a bump or an edit changes a chart under `infra/charts/` (also when adding a component), run `npm --prefix tools/kore run test:container-smoke` (needs docker). It runs each container's pinned image with its rendered env and args and fails on an early exit, `address already in use`, or a fatal log line. Containers needing cluster resources are skipped with a printed reason.
