---
summary: Release the Istio gateway proxy when the gateway class changes
hypothesis: Changing the gateway class to agentgateway releases the Istio proxy in phase 2 of the live run, already tested live on kore-local.
expected-outcome: Phase 2 of the live proof releases the Istio proxy and leaves one gateway owner.
measurement: Phase 2 of the live-run recorded on issue 207.
safety-pattern: feature-flagged
date: 2026-11-15
issue: 207
outcome: confirmed
---

# Idea 0003: Release the Istio gateway proxy when the gateway class changes

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: gateway-class-change-release
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/207#issuecomment-6897416287
- Recorded: 2026-11-15

Live phase 2 released the Istio proxy on kore-local.
