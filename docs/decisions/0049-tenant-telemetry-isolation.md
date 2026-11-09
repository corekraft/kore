---
status: accepted
summary: Telemetry backends stay shared, each tenant root gets its own Grafana signed in through its Keycloak, Loki and Tempo separate tenants natively, Prometheus is read through a label-enforcing proxy, and Mimir replaces it when per-tenant metric retention or limits are needed.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0049: Isolate telemetry per tenant with a Grafana each and tenant-scoped queries

Source: [`docs/vision.md` § Observability Out of the Box](../vision.md#observability-out-of-the-box)

Refines: [ADR 0010](0010-opentelemetry-collector-ingestion.md) and
[ADR 0019](0019-telemetry-pipeline-wiring.md).

## Context

The Collector stamps tenant and organization attributes from namespace labels,
and each tenant must query only its own telemetry. Loki and Tempo separate
tenants natively through a tenant header; Prometheus does not. Each tenant has
its own Keycloak ([ADR 0040](0040-keycloak-human-identity.md)), so a single
shared Grafana would have to trust many identity providers.

## Decision

- **Shared backends.** Prometheus, Loki, and Tempo stay platform components.
  The Collector routes each signal with its tenant identifier.
- **Loki and Tempo run multi-tenant,** keyed by the tenant root identifier.
- **Prometheus is read through a label-enforcing proxy,** such as
  prom-label-proxy, that forces every query to the caller's tenant label.
  Writes are labeled by the Collector, never by the service.
- **One Grafana per tenant root,** composed by the `Organization` API alongside
  the tenant's Backstage, Argo CD, and Keycloak, signed in through that
  tenant's Keycloak, with datasources fixed to the tenant.
- **The tenant is the query boundary.** Within a tenant, dashboards are
  foldered per organization with group permissions; organizations in the same
  tenant are not separated at the data layer.
- **Mimir later.** Mimir replaces Prometheus as the metrics store when a tenant
  needs its own metric retention or series limits.

## Consequences

- `grafana` becomes a reserved service name in a tenant's base.
- The platform Grafana stays for operators and sees every tenant.
- Moving to Mimir is a catalog change with its own ADR and compatibility
  evidence.
