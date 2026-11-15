---
summary: Serve ingress with agentgateway in local
hypothesis: Serving the platform Gateway with agentgateway instead of Istio ingress converges in local and routes a Gateway request, already tested live on kore-local.
expected-outcome: Phases 1 to 4 of the live proof pass, including the Gateway request step, with memory and CPU no worse than the Istio baseline.
measurement: The live-run phases recorded on issue 207 and the resource comparison recorded on issue 212.
safety-pattern: feature-flagged
date: 2026-11-15
issue: 207
outcome: confirmed
---

# Idea 0002: Serve ingress with agentgateway in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: ingress-agentgateway
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/207#issuecomment-6897416287
- Recorded: 2026-11-15

Live phases 1 to 4 passed on kore-local including the Gateway request step; #212 measured memory down 68 percent and CPU neutral (https://github.com/corekraft/kore/issues/212#issuecomment-6900331792).
