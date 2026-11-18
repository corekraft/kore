---
status: proposed
summary: Under platform-portal with an address set, the metrics store loads the Service rule file and forwards fired alerts to Grafana's own alert manager, which keeps the one contact point; the notify-only label is renamed enforcement: notify-only because it never gated delivery.
date: 2026-11-18
last-verified: 2026-11-18
---

# ADR 0128: Forward fired Service alerts from the metrics store to Grafana's alert manager

Source: [`infra/plans/15-next-horizon.md` § Parked Owner Questions](../../infra/plans/15-next-horizon.md#parked-owner-questions)

Refines: [ADR 0114](0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md)

## Context

#709 provisions an email contact point and a root policy in Grafana, but a fired
Service alert could not reach it: the metrics store mounted the platform rules
only, so the Service rules in `kore-service-rules` were never evaluated, and its
alert manager is disabled, so nothing forwarded what fired. ADR 0114 also says
Alertmanager serves the platform organization; it does not say which one. The
rules carried `notify: "false"`, which no code read, while the root policy
sent every alert to the contact point.

## Decision

- **Grafana's own alert manager receives fired alerts.** The metrics store
  sends them to `/api/alertmanager/grafana` on the Grafana service, so the
  contact point and policy stay the one desired-state object that #709 built,
  and no second alert manager or second contact point exists. Rejected: the
  chart's own Alertmanager (it would need its own email receiver, a second
  owner of the destination) and Grafana-managed rules (the Service rules would
  live in two places).
- **The Service chart owns every Service rule.** The metrics store only loads
  the file `kore-service-rules` holds; the platform rules stay with the
  observability configuration chart.
- **Only under `platform-portal` and an address.** The mounts, the rule file
  entry, the reload watch and the forwarding target are Helm arguments for the
  `prometheus` release that exist only while the portal flag is on and an
  alert address is set at run time. Every other environment renders as
  before, so the change is dark-launched.
- **The mounts are optional.** The metrics store installs before Grafana and
  the Service chart, so a required ConfigMap or Secret would stall its
  readiness. The kubelet fills an optional mount when its object appears, and
  the reload sidecar watches the directory so new Service rules load without a
  restart.
- **Grafana's admin password is read from a mounted file.** Grafana requires
  authentication on its alert manager API, so the metrics store mounts the
  Grafana release's admin Secret and reads the password from the file. No
  credential is ever an argument, a value or a committed file.
- **The notify-only label means "advisory", and is renamed.** `notify: "false"`
  read as "do not notify", the opposite of behaviour. Rules now carry
  `enforcement: notify-only`: the alert only tells an operator and never
  blocks, rolls back or scales anything (audit before enforce). It does not
  gate delivery: with an address set, every fired alert is emailed, grouped by
  service and alert name.

## Consequences

- A fired Service alert reaches the contact point when the flag and an address
  are set. A live delivery proof is still owed (plan 15, Step 6 item 4).
- The Grafana admin password is mounted into the metrics store pod. Replacing
  it with a narrower service account token is a later refinement.
- Platform alerts take the same path, with no `service` label, so each one
  groups by its alert name.
