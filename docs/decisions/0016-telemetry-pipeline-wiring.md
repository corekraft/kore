---
status: accepted
summary: The telemetry pipeline is split into a gateway Collector and a node agent, rules and dashboards are owned by one local chart, and metric attributes pass an explicit allowlist.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0016: Wire telemetry as separate pipelines with bounded cardinality

Source: [`infra/plans/2-implementation.md` § Step 11: Observability](../../infra/plans/2-implementation.md#step-11-observability)

## Context

The Collector's Prometheus exporter and self-metrics were unreachable, the
alert rules and the reference dashboard were installed by nothing, and the
PrometheusRule CRD is not installed. Pod-level metrics would have exploded
series counts.

## Decision

- **One owner per file.** The `kore-observability-config` local chart owns the
  rule file, the dashboards, and the mesh `Telemetry` resource. Prometheus
  mounts the rules ConfigMap as a rule file and Grafana provisions dashboards
  from its ConfigMap. We use plain rule files, not the PrometheusRule CRD, and
  keep Alertmanager disabled until routing is designed.
- **Two Collectors, separate pipelines.** The `otel-collector` gateway keeps
  OTLP ingestion and `k8s_cluster` metrics (`metrics/cluster`). The `otel-agent`
  DaemonSet runs `filelog` (`logs/pods`) and `kubeletstats` (`metrics/kubelet`)
  with `get`-only RBAC and forwards over OTLP to the gateway, which enriches.
- **Environment attributes come from environment config.** Cluster name and
  environment name are set in per-environment `otel-collector` values overlays.
- **Cardinality.** Metrics pass a resource and datapoint attribute allowlist that
  excludes `k8s.pod.name` and `k8s.pod.uid`; pod and container metrics from
  `k8s_cluster` are filtered out and kubelet metrics are node-level only. Logs
  and traces keep pod identity for correlation.
- **Istio.** An `otel-tracing` extension provider points at the gateway; a
  mesh-wide `Telemetry` selects it at a configurable sampling percentage.

## Consequences

- Per-pod resource metrics are unavailable until a deliberate series budget exists.
- Rules depend on collector self-metric names (`*_total`); a chart upgrade that
  renames them fails `mise run test-promtool` only if the tests are updated, so
  re-check names on collector upgrades.
- None of this has run on a live cluster; the live bootstrap remains required.
