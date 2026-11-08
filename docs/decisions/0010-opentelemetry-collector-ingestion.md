---
status: accepted
summary: Applications send OTLP only to the OpenTelemetry Collector, which enriches and exports to Prometheus, Loki, and Tempo, with Grafana for queries.
date: 2026-09-12
last-verified: 2026-11-07
---

# ADR 0010: Make the OpenTelemetry Collector the only telemetry ingress

Source: [`infra/plans/1-initialize.md` § Observability](../../infra/plans/1-initialize.md#observability)

## Context

Applications that talk to a storage backend directly are tied to it. The
platform wants to swap the local backends for managed ones without changing
application instrumentation.

## Decision

- Applications send OTLP logs, metrics, and traces only to the OpenTelemetry
  Collector, never directly to a backend.
- The Collector enriches signals with Kubernetes and workload identity
  attributes and exports metrics to Prometheus, logs to Loki, and traces to
  Tempo. Grafana is the correlated query interface.
- Istio telemetry flows through the same path where the signal allows.

## Consequences

Backends are replaceable per environment. The Collector is a required
capability: its failure must show in platform status, and pipelines need
cardinality, retention, and resource limits.
