---
summary: Bring a writer's pull request up to date with main without a main-session message
hypothesis: If the harness notices that a writer's pull request is behind or conflicts with main and updates the branch itself when it merges cleanly, or sends the writer the merge instruction when it conflicts, the main session stops typing those follow-ups
expected-outcome: Since 2026-11-12 the main session sent 100 follow-ups in 82 writer sessions telling the writer to merge or rebase on origin/main (conflicts, main fixed, merged dependencies). They fall to under 10 in 14 days, and rework.mainFollowUpsPerWriterSession falls
measurement: rework.mainFollowUpsPerWriterSession in harness flow report, with a count of writer follow-ups that name origin/main from the retro scan
safety-pattern: feature-flagged
date: 2026-11-17
kind: harness
hypothesis-metric: rework.mainFollowUpsPerWriterSession
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/965
---

# Idea 0023: Bring a writer's pull request up to date with main without a main-session message
