---
status: proposed
summary: The external-dns sync-error and certificate alerts render as Grafana-managed rules in the observability configuration chart, behind their flags, because Grafana's one contact point is the only route a notify-only alert reaches.
date: 2026-11-24
last-verified: 2026-11-24
---

# ADR 0182: Platform alerts for external-dns and certificates are Grafana-managed rules

Source: [`infra/plans/15-next-horizon.md` § Parked Owner Questions](../../infra/plans/15-next-horizon.md#parked-owner-questions)

Refines: ADR 0177

## Context

ADR 0114 keeps platform rules in the observability configuration chart. The
platform rule file there is a Prometheus rule file, and Prometheus has no route
to the contact point: its Alertmanager is off (#1927), and ADR 0177 removed the
path that pushed alerts to Grafana. A notify-only platform alert, such as an
external-dns sync error or a certificate that is not Ready or near expiry
(#1619), reaches the one contact point only through Grafana's root policy, the
route ADR 0177 gave Service rules.

## Decision

- **Grafana evaluates the platform alerts.** The observability configuration
  chart renders them as Grafana-managed rules in the ConfigMap
  `kore-platform-alert-rules`, labelled `grafana_alert: "1"`, over the
  Prometheus datasource, in the same folder and with the same notify-only
  labels as the Service rules. Grafana's one root policy routes what fires to
  the one platform contact point. No new destination is added.
- **Each alert renders only while its flag is on.** The external-dns sync-error
  rule renders under `external-dns`; the certificate rules, not Ready and near
  expiry, render under `acme-dns01`. With both flags off the chart renders
  byte-identical to main.
- **Prometheus keeps the platform rule file, unchanged.** Nothing is added to
  it, and it still holds no Grafana credential.

## Consequences

- The platform alerts have the same owner and the same route as the Service
  alerts: Grafana. ADR 0177's single owner for notify-only rules now includes
  the platform alerts, and the Prometheus rule file keeps only rules that no
  alert route needs.
- The rules load only where Grafana's alerting sidecar runs, under
  `platform-portal` with an alert address (ADR 0177). Elsewhere they are
  inert, as the Service rules are.
- The external-dns sync-error rule needs the external-dns metrics to be
  scraped. The pinned external-dns chart adds no `prometheus.io/scrape`
  annotation and its ServiceMonitor needs a CRD the cluster does not install,
  so until the component is annotated or a scrape is added (an owner decision,
  since it rolls the pod), the rule stays quiet.
- Not yet proven live: that Grafana accepts the provisioned platform rules, and
  that a fired platform alert reaches the contact point. A live run owes that
  proof, as ADR 0177 does for the Service rules.
