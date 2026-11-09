---
status: accepted
summary: Mesh identity reaches Prometheus by scraping ztunnel directly, trace and log correlation is a Grafana datasource link on trace_id, and Step 11 proofs split into offline specs plus one opt-in live spec.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0062: Prove telemetry offline where possible, scrape ztunnel for mesh identity

Source: [`infra/plans/2-implementation.md` § Step 11: Observability](../../infra/plans/2-implementation.md#step-11-observability)

Refines: [ADR 0019](0019-telemetry-pipeline-wiring.md)

## Context

ADR 0019 routes application telemetry through the Collector, but three exit
criteria had no mechanism: Istio source and destination identity, trace-to-log
correlation in Grafana, and OPA decision correlation. In the ambient profile
the workload principals are labels on ztunnel's TCP metrics, not OTLP.

## Decision

- **Mesh identity is the one non-OTLP metric source.** Prometheus keeps the
  chart's default pod scrape, which picks up ztunnel's `prometheus.io/scrape`
  annotation (port 15020). The series `istio_tcp_connections_opened_total`
  carries `source_principal` and `destination_principal`; a `Kore Mesh Identity`
  dashboard shows them. Platform components are not applications, so this does
  not break "applications send telemetry only to the Collector".
- **Correlation is a datasource link.** Tempo links traces to Loki logs
  filtered by trace id, and Loki derives a link to Tempo from the `trace_id`
  structured metadata that the Collector's OTLP log export produces.
- **OPA decisions correlate through the request headers.** Decision logs stay
  on the console with only secret headers masked, so `traceparent` and
  `x-request-id` remain in each record and are found by LogQL.
- **Proof split.** Offline specs pin wiring, status behavior, and the absence of
  direct backend addressing in `apps/`. One opt-in spec
  (`npm run test:integration:telemetry`) posts synthetic OTLP through a short-lived
  `kubectl port-forward` and reads each backend back; it creates nothing.
- **Loopback receiver for the forward.** The chart binds OTLP to the pod IP
  (`${env:MY_POD_IP}:4318`), and a port-forward dials the pod's loopback, so
  the forward was accepted locally and then closed (`UND_ERR_SOCKET`). The
  Collector gains `otlp/loopback`, OTLP/HTTP on `127.0.0.1:4319`, in the same
  three pipelines. It is unreachable from the network, so it adds no exposure
  and leaves the pod-IP receiver untouched. An in-cluster Job was rejected: the
  only catalog image with `curl` (`gatekeeper-curl`) is unsigned, and a pull
  under the `Never` policy and admission cannot be proven offline. The spec
  also waits for an answered HTTP request and retries resets a bounded number
  of times.

## Consequences

- Nothing here has run live; the integration spec must pass before Step 11 is ticked.
- A backend that is ready but rejecting Collector exports shows through the
  `KoreCollectorExporterFailure` alert, not `kore platform status`.
- No NetworkPolicy blocks an application from reaching a backend; the check is
  a source scan, not cluster enforcement.
