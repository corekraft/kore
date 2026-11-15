---
status: proposed
summary: In Then, retention is overridable per tenant with ingestion limits in Loki and Tempo, per-tenant metric retention comes with Mimir, and tenant alerts run in each tenant's Grafana with contact points from the Organization API. The platform organization's defaults are ADR 0114, in Next.
date: 2026-11-09
last-verified: 2026-11-14
---

# ADR 0051: Set telemetry retention per tenant and route alerts through each tenant's Grafana

Source: [`docs/vision.md` § Observability Out of the Box](../vision.md#observability-out-of-the-box)

Refines: [ADR 0019](0019-telemetry-pipeline-wiring.md), which kept Alertmanager
disabled until routing was designed.

## Context

This ADR covers the Then part only: tenant alert routing and per-tenant
retention overrides need the tenancy model
([ADR 0050](0050-tenant-telemetry-isolation.md)). Default dashboards,
notify-only alerts, default retention and platform alerts, in Next, are
[ADR 0114](0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md).

Each organization should get default dashboards and alerts, retention set per
tenant, and telemetry volume counted toward usage. Loki and Tempo support
per-tenant retention and ingestion limits; Prometheus has one retention for
everything. Each tenant has its own Grafana
([ADR 0050](0050-tenant-telemetry-isolation.md)).

## Decision

- **Retention is overridable per tenant,** within its quota, through Loki and
  Tempo per-tenant settings, with per-tenant ingestion limits; the defaults are
  ADR 0114.
- **Per-tenant metric retention and series limits** come with Mimir.
- **Tenant alerts run in the tenant's Grafana.** Default alert rules for each
  service are provisioned there, and contact points come from the
  `Organization` resource, so organizations manage where their alerts go.

## Consequences

- Telemetry ingestion per tenant is reported as usage and bounded by the Loki
  and Tempo limits.
- Alert rules for tenants and for the platform live in two places by design;
  the platform rules stay in the observability configuration chart
  ([ADR 0114](0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md)).
