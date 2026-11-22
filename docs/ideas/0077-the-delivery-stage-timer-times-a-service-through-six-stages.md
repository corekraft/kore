---
summary: The delivery-stage timer times a Service through six stages live in local
hypothesis: With the shared Gateway on, the timer reads a time source for each of the six delivery stages and reports a cold and a redeploy run
expected-outcome: npm run test:live:delivery-stage passes on delivery-probe with a cold and a redeploy run, each with all six stages
measurement: live run records on corekraft/kore#1113
safety-pattern: no-behaviour-change
date: 2026-11-22
issue: 1113
outcome: confirmed
---

# Idea 0077: The delivery-stage timer times a Service through six stages live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Evidence: https://github.com/corekraft/kore/issues/1113#issuecomment-7075496681
- Recorded: 2026-11-22

Runs on kore-agents, 2026-11-22. Cold run d on main 18497319 (timer fix #1749, namespace label #1740): npm run test:live:delivery-stage passed with all six stages reading a time source, namespace 51 s, sync 12 s, rollout 30 s, total 93 s; the certificate stage read the shared HTTPRoute Accepted time. Redeploy run e on release v0.21.0 (comment 7075820955): passed, series redeploy, sync 423 s and rollout 129 s but inflated by a cold-started cluster, so not representative. Stages that read 0 s are clamped by the timeline. No flag changes. The owner approved recording on 2026-11-22.
