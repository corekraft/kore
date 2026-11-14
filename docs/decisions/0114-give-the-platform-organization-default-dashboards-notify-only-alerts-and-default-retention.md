---
status: accepted
summary: In Next, services get default dashboards and notify-only alerts in the platform Grafana, logs keep 14 days and traces 7, metrics keep one platform retention, and Alertmanager serves platform alerts only.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0114: Give the platform organization default dashboards, notify-only alerts and default retention

Source: [`infra/plans/15-next-horizon.md` § Step 1](../../infra/plans/15-next-horizon.md#step-1-accept-the-next-adrs)

Refines: ADR 0051

## Context

[ADR 0051](0051-telemetry-retention-and-alerting.md) mixes two horizons. Tenant
alert routing and per-tenant retention overrides need the tenancy model, so
they arrive in Then. Default dashboards, notify-only alerts, default retention
and platform alerts need none, and services in the platform organization need
them in Next ([plan 15](../../infra/plans/15-next-horizon.md)). The split lets
Next accept its part without accepting tenant tooling that has no tenant to
serve, as was done for
[ADR 0111](0111-run-a-backstage-and-an-argo-cd-for-the-platform-organization-s-operators.md)
and [ADR 0113](0113-run-a-keycloak-for-the-platform-organization-s-operators.md).

## Decision

- **Per-service dashboards and default alerts** are provisioned in the
  platform Grafana. Default alerts start notify-only until their thresholds are
  measured (audit before enforce,
  [ADR 0017](0017-gatekeeper-policy-families-audit-first.md)).
- **Default retention:** logs 14 days and traces 7 days.
- **Metrics keep one platform retention** until Mimir arrives.
- **Alertmanager serves the platform organization only,** for operator alerts
  from the platform rule files.

ADR 0051 keeps the per-tenant clauses, which stay in Then.

## Consequences

- Services get dashboards and alerts that notify nowhere until an alert
  destination is named (plan 15's parked owner question).
- Alert rules for services and for the platform live in two places by design;
  the platform rules stay in the observability configuration chart.
- ADR 0051's per-tenant design builds on this one rather than replacing it.
