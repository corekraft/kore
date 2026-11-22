---
summary: A service alert reaches the platform contact point live in local
hypothesis: With the alert rules as Grafana-managed rules, a firing service alert is routed by Grafana to the platform contact point and arrives in the inbox
expected-outcome: npm run test:live:alert-delivery passes: contact point kore-platform-email delivered, inbox arrived
measurement: live run records on corekraft/kore#1118
safety-pattern: feature-flagged
date: 2026-11-22
issue: 1118
outcome: confirmed
---

# Idea 0075: A service alert reaches the platform contact point live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Evidence: https://github.com/corekraft/kore/issues/1118#issuecomment-7074800637
- Recorded: 2026-11-22

Run a on main c5d1d2ae: test:live:alert-delivery passed. Grafana routed ServiceUnavailable on golden-path-example to kore-platform-email (delivered) and the inbox received it (arrived). The deployment was scaled back to 2/2. The wiring stays behind platform-portal, already on in local; no flag changes. The owner approved recording on 2026-11-22.
