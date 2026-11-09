---
status: accepted
summary: A component's catalog `patches` set integer probe fields a chart gives no value for, applied by a repository-kept Helm post-renderer plugin so render and upgrade show the same output.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0081: Declarative probe patches through a Helm post-renderer

Source: [`infra/plans/2-implementation.md` § Progress Record](../../infra/plans/2-implementation.md#progress-record)

Refines: [ADR 0016](0016-release-readiness-checks-drive-wait-and-status.md)
(status bounds) and the "desired state lives in the repository" principle.

## Context

On kore-local the cloudnative-pg operator restarted 25 times in 12 hours: its
chart renders the `/readyz` probes with the Kubernetes default `timeoutSeconds`
of 1 and exposes no value to change it, so a loaded laptop killed a healthy
operator. The opentelemetry-operator and policy-controller charts hard-code
their probes the same way. A post-install `kubectl patch` would give a second
owner to the Deployment, and Kore has no other way to adjust rendered manifests.

## Decision

- A catalog component may list `patches`: each names a `target` (`kind`,
  `name`, `container`), a required `reason`, and the `probes` fields to set
  (`livenessProbe`, `readinessProbe`, `startupProbe`; integer fields only).
  The schema and `kore validate` check them before any cluster is touched.
- Helm applies them through its own `--post-renderer` mechanism. Helm 4 takes a
  post-renderer by plugin name, so Kore keeps the plugin in
  `infra/helm-plugins/kore-patch` and sets `HELM_PLUGINS` to that directory for
  the helm call, instead of installing anything into the user's Helm
  configuration. The plugin runs Kore's own Node entry point
  (`tools/kore/dist/src/cli/post-render.js`, standard library only), which
  reads the manifest stream on stdin and writes it to stdout.
- The patch list is the one `--post-renderer-args` argument, so it is part of
  the desired-state fingerprint and a changed patch upgrades the release on
  resume. `kore platform render` and `helm template` use the same arguments, so
  the patched probes are visible and reviewable.
- Only the listed fields of a probe the chart already renders are set. A
  missing workload, container, or probe fails the render, so a chart bump
  cannot silently drop a patch. Probes written in flow style are refused.
- Patched: cloudnative-pg (liveness `timeoutSeconds` 5 and `failureThreshold`
  6, readiness and startup `timeoutSeconds` 5), opentelemetry-operator (the
  same for liveness and readiness) and policy-controller's webhook
  (`timeoutSeconds` 5; its Knative `k-kubelet-probe` probe is a standard
  kubelet `httpGet` probe with a header).
- Status checks use a 15s bound for `kubectl wait` and `rollout status`
  (ADR 0016 said 3s) because the bound spans kubectl's startup; polled checks
  keep 3s. A failure names the bound actually waited.

## Consequences

- The post-renderer runs from `tools/kore/dist`, so the CLI must be built
  (it already is for `kore`); a missing build fails with a message.
- Helm shows only "plugin exited with error" for a failed patch. The cause is
  the catalog target, which `npm run test:upstream-charts` (the probe-tolerance
  spec) reports when a chart bump moves it.
- The patcher edits block-style YAML text, not a parsed document; it is
  deliberately limited to probe integer fields.
- `HELM_PLUGINS` replaces the user's plugin directory for those calls only.
