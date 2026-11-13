---
status: proposed
summary: Logs keep 14 days and traces 7 days by default with per-tenant overrides and ingestion limits in Loki and Tempo, metrics keep one platform retention until Mimir, tenant alerts run in each tenant's Grafana with contact points from the Organization API, and Alertmanager serves platform alerts only.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0051: Set telemetry retention per tenant and route alerts through each tenant's Grafana

Source: [`docs/vision.md` § Observability Out of the Box](../vision.md#observability-out-of-the-box)

Refines: [ADR 0019](0019-telemetry-pipeline-wiring.md), which kept Alertmanager
disabled until routing was designed.

## Context

Each organization should get default dashboards and alerts, retention set per
tenant, and telemetry volume counted toward usage. Loki and Tempo support
per-tenant retention and ingestion limits; Prometheus has one retention for
everything. Each tenant has its own Grafana
([ADR 0050](0050-tenant-telemetry-isolation.md)).

## Decision

- **Default retention:** logs 14 days and traces 7 days, overridable per tenant
  within its quota through Loki and Tempo per-tenant settings, with per-tenant
  ingestion limits.
- **Metrics keep one platform retention** until Mimir arrives; per-tenant
  metric retention and series limits come with it.
- **Tenant alerts run in the tenant's Grafana.** Default alert rules for each
  service are provisioned there, and contact points come from the
  `Organization` resource, so organizations manage where their alerts go.
- **Alertmanager serves the platform organization only,** for operator alerts
  from the platform rule files.

## Consequences

- Telemetry ingestion per tenant is reported as usage and bounded by the Loki
  and Tempo limits.
- Alert rules for tenants and for the platform live in two places by design;
  the platform rules stay in the observability configuration chart.
