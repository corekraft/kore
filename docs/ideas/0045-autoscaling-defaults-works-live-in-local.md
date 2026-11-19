---
summary: autoscaling-defaults works live in local
hypothesis: With autoscaling-defaults on in local, the metrics server runs and the reference workload's CPU HorizontalPodAutoscaler scales out under load and back in once it stops, with no pod OOMKilled and Docker VM memory in use under 85 percent.
expected-outcome: metrics-server is Ready, reference-api scales from 2 to 5 replicas under CPU load and returns to 2, and the footprint stays under the breach rule.
measurement: Live run recorded on issue 1109 (comment 6994972736): reference-api went 2 to 5 to 2 replicas; VM memory in use 57 percent before and 62 percent after; no OOMKilled.
safety-pattern: dark-launched
date: 2026-11-18
issue: https://github.com/corekraft/kore/issues/1281
outcome: confirmed
---

# Idea 0045: autoscaling-defaults works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: autoscaling-defaults
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/1109#issuecomment-6994972736
- Recorded: 2026-11-18

Live run on a throwaway local profile: metrics server running, reference-api HPA scaled 2 to 5 to 2 replicas under CPU load, VM memory in use 57 percent before and 62 percent after, no OOMKilled. Run id: issue 1109 comment 6994972736.
