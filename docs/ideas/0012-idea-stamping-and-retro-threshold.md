---
summary: Stamp every loop event with its idea and stage
hypothesis: If every spawned session and its tool events carry the idea and stage, and the retro scan counts its history minimum in sessions as well as days, the flow report can measure write, review, judge and verify and the retro can propose.
expected-outcome: Events with an idea and a stage rise from 461 of 64,688 to over half of new events, the write, review, judge and verify stages show events, and tokens per idea leaves insufficient history.
measurement: attribution.withIdeaAndStage against attribution.events in harness flow report.
safety-pattern: no-behaviour-change
date: 2026-11-16
kind: harness
hypothesis-metric: attribution.withIdeaAndStage
hypothesis-direction: up
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/799
outcome: refuted
---

# Idea 0012: Stamp every loop event with its idea and stage

## Outcome

- Result: refuted
- Kind: experiment
- Source: journal
- Evidence: Mac ledger since 2026-11-13: 8,044 of 59,554 role-session events carry an idea and stage (13.5%); 22% since 2026-11-16T14:15Z and 4.8% since 2026-11-18T02:06Z, against a target of over half; review stage 9 events, verify 0; the share peaked near 50% on 2026-11-17
- Recorded: 2026-11-20

On the Mac ledger, which holds the full history, the share of events with an idea and stage never reached half and fell to 4.8% after 2026-11-18. An earlier reading of 63% covered 8 hours on the kore-agents ledger only and was recorded as inconclusive.
