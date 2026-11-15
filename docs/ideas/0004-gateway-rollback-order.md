---
summary: Roll back the gateway in order
hypothesis: Rolling the gateway back to Istio converges in phase 4 of the live run, already tested live on kore-local.
expected-outcome: Phase 4 rollback converges with ingress served again by Istio.
measurement: Phase 4 of the live-run recorded on issue 207.
safety-pattern: feature-flagged
date: 2026-11-15
issue: 207
outcome: confirmed
---

# Idea 0004: Roll back the gateway in order

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: gateway-rollback-order
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/207#issuecomment-6897416287
- Recorded: 2026-11-15

Live phase 4 rollback converged on kore-local.
