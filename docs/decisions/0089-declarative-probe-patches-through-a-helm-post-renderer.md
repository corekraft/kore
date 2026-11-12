---
status: accepted
summary: A component's catalog patches set integer probe fields a chart gives no value for, applied by a repository-kept Helm post-renderer plugin so render and upgrade show the same output.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0089: Declarative probe patches through a Helm post-renderer

Source: [`infra/plans/9-k3d-local-cluster.md`](../../infra/plans/9-k3d-local-cluster.md)

## Context

policy-controller (chart 0.10.8) renders its webhook probes with a 1s period and
the Kubernetes default 1s `timeoutSeconds`, and the chart has no value to change
them. Under host load the kubelet's probe times out and restarts the pod, so
admission briefly has no endpoint; `resilience` flaked once on k3d (#149).
A post-install `kubectl patch` would give the Deployment a second owner, and
Kore has no other way to adjust rendered manifests.

Stale PR #119 proposed the same mechanism, numbered ADR 0081 (a number since
taken by another decision). It was never merged, so this ADR supersedes
nothing; it renumbers and narrows that proposal to the one component that needs
it now.

## Decision

- A catalog component may list `patches`: each names a `target` (`kind`,
  `name`, `container`), a required `reason`, and the `probes` fields to set
  (`livenessProbe`, `readinessProbe`, `startupProbe`; integer fields only).
  The schema and `kore validate` check them before any cluster is touched: a
  patch and its target accept only known keys, each probe is a non-empty plain
  object of positive integers, `successThreshold` must be 1 for liveness and
  startup probes, and a manifest component cannot carry patches.
- Helm applies them through its own `--post-renderer`. Helm 4 takes a
  post-renderer by plugin name, so Kore keeps the plugin in
  `infra/helm-plugins/kore-patch` and sets `HELM_PLUGINS` to that directory for
  the helm call, instead of installing anything into the user's Helm
  configuration. The plugin runs Kore's own Node entry point
  (`tools/kore/dist/src/cli/post-render.js`, standard library only), which
  reads the manifest stream on stdin and writes it to stdout.
- The patch list is the one `--post-renderer-args` argument, so it is part of
  the desired-state fingerprint and a changed patch upgrades the release on
  resume. `kore platform render` and `helm template` use the same arguments, so
  the patched probes are visible and reviewable. A component without patches
  gets no post-renderer and no `HELM_PLUGINS`, so it renders unchanged.
- Only the listed fields of a probe the chart already renders are set. A
  missing workload, container, or probe fails the render, so a chart bump
  cannot silently drop a patch. A probe written in flow style is refused with a
  message to check the chart version or its values.
- When a Helm call fails for a component with patches, Kore renders the chart
  without the post-renderer and applies the patches in-process, and reports the
  patcher's own error, because Helm hides it as "plugin exited with error".
- Patched now: policy-controller's `policy-controller-webhook` liveness and
  readiness probes, `timeoutSeconds` 5.

## Consequences

- The post-renderer runs from `tools/kore/dist`, so the CLI must be built (it
  already is for `kore`); a missing build fails with a message.
- Helm shows only "plugin exited with error" for a failed patch; the
  in-process diagnosis above names the cause, and the upstream chart spec
  reports a moved target on a chart bump.
- The patcher edits block-style YAML text, not a parsed document, and is
  deliberately limited to probe integer fields.
- `HELM_PLUGINS` replaces the user's plugin directory for those calls only.
- There is no feature flag. The patch applies on the next `kore local up` or
  `kore platform up`, so the change is not flag-gated: a k3d live run, with
  `resilience` passing first time under the suite's load, gates merging, not
  flag activation (ADR 0077: nothing would gate it afterwards).
