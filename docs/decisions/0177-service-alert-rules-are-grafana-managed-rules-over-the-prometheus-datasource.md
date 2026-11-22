---
status: accepted
summary: Service alert rules are provisioned into Grafana over the Prometheus datasource and route to the single contact point; Prometheus keeps the platform rule file and no longer pushes alerts to Grafana.
date: 2026-11-22
last-verified: 2026-11-22
---

# ADR 0177: Service alert rules are Grafana-managed rules over the Prometheus datasource

Source: [`infra/plans/15-next-horizon.md` § Parked Owner Questions](../../infra/plans/15-next-horizon.md#parked-owner-questions)

Refines: [ADR 0128](0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md)

## Context

ADR 0128 sent fired Service alerts from the metrics store to Grafana's own
alert manager, at `/api/alertmanager/grafana` with the Grafana admin password
read from a mounted file, and kept the Service rules in the metrics store's
rule file. Grafana 12.3.1 cannot accept pushed alerts: the alert POST answers
400 for a bare array and 404 `data source not found` for the wrapped body (#1732),
and the live delivery proof (#1118, 2026-11-22) failed at `alert not forwarded`
with Prometheus sending every alert to a 400 (#1118). The source of Grafana 9.5
through 13.3 shows that the only alert POST route proxies to an Alertmanager
data source, so no version in that range receives pushed alerts. ADR 0128 had
rejected Grafana-managed rules because the Service rules would then live in two
places; the owner decided on 2026-11-22 to take that option, with a single owner
for the Service rules.

## Decision

- **Grafana evaluates the Service rules.** The service-observability chart
  renders them as Grafana-managed alert rules in the ConfigMap
  `kore-service-rules`, labelled `grafana_alert: "1"`. Each rule queries the
  Prometheus datasource (uid `prometheus`). Grafana's one root policy routes
  what fires to the one platform contact point, as before.
- **Grafana loads them through its alerting sidecar.** Under `platform-portal`
  with an alert address set, the Grafana release gains the sidecar for alerting
  provisioning. It reads only ConfigMaps labelled `grafana_alert=1` in
  `observability`, and asks Grafana to reload them.
- **Prometheus keeps the platform rule file only.** It no longer loads Service
  rules, no longer lists Grafana as an Alertmanager, and no longer mounts the
  Grafana admin Secret. Its alerting stays disabled.
- **The gate is unchanged.** Under `platform-portal` and an address only; every
  other environment renders as before.

This refines ADR 0128: its forwarding target, its Service rule owner, its mounts
and its admin password are replaced. Its notify-only label and its gate stay.

## Consequences

- One owner holds the Service rules and the contact point, Grafana, so the
  Grafana admin password is no longer mounted into the metrics store.
- The live alert proof reads the rule state from Grafana's rules API, not from
  Prometheus, and runs from the Grafana pod.
- The chart edit moves the content-addressed chart lock.
- A live run owes the proof: that Grafana accepts the provisioned rules, that
  the sidecar reloads them, and that a fired alert reaches the contact point
  (#1118, #1732). Until that run is green no outcome is recorded.
