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
outcome: inconclusive
---

# Idea 0012: Stamp every loop event with its idea and stage

## Outcome

- Result: inconclusive
- Kind: experiment
- Source: journal
- Evidence: 4,731 of 7,512 events carry an idea and stage (63%) over 8 hours only; review, judge and verify show 0 events; tokens per idea has 2 closed ideas of 6 needed
- Recorded: 2026-11-20

63% of events carry an idea and stage, but over only 8 hours, and tokens per idea has 2 of 6 closed ideas needed.
