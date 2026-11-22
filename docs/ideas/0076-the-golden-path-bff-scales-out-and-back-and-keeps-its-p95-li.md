---
summary: The golden-path BFF scales out and back and keeps its p95 live in local
hypothesis: With the BFF cpu request at 100m, the golden-path autoscaler scales the BFF from 2 to 5 and back to 2 under load with no failed request, and the golden-path route set answers within a recorded p95
expected-outcome: npm run test:live:golden-path-load passes: replicas 2 to 5 to 2, 0 failed requests, p95 recorded
measurement: live run records on corekraft/kore#1114
safety-pattern: feature-flagged
date: 2026-11-22
issue: 1114
outcome: confirmed
---

# Idea 0076: The golden-path BFF scales out and back and keeps its p95 live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Evidence: https://github.com/corekraft/kore/issues/1114#issuecomment-7053690092
- Recorded: 2026-11-22

Run on main 2da0f0de (BFF cpu request 100m, #1487), chart lock main-charts-4 and the v0.17.0 template lock, kore local up --require-fresh-lock exit 0: replicas 2 to 5 to 2 under 46350 requests, 0 failed, scale-down window 300 s; golden-path route set at the service Gateway p50 4.2 ms, p95 16.4 ms, max 51.9 ms over 360 requests. The flag autoscaling-defaults is already confirmed by idea 0045; no flag changes here. The owner approved recording on 2026-11-22.
