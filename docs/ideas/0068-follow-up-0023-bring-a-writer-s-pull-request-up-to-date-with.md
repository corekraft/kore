---
summary: Follow up on idea 0023 after a inconclusive outcome
hypothesis: After a inconclusive outcome on idea 0023, revisit: If the harness notices that a writer's pull request conflicts with main, or is ready to merge but for being behind, and sends the writer one signed message to merge origin/main, the main session stops typing those follow-ups
expected-outcome: Since 2026-11-12 the main session sent 69 follow-up sends (cut #977): 40 conflict, 5 behind-and-ready, 13 main-fixed, 11 other. Conflict and behind-and-ready together (45) fall to at most 4 in 14 days (10 percent of 45), with the main-fixed count (13) stated beside them; main-fixed is not a target
measurement: Primary: the retro scan's count of writer follow-ups that name origin/main per 14 days, counting herdr prompts and session send, classed as in the cut. The flow report path for the hypothesis is rework.mainFollowUpsPerWriterSession, which reads insufficient history until the notice writes its events. Guard metrics: rework.followUpsPerWriterSession, tokensPerMergedChange.current and sendBacksPerMergedChange.current
safety-pattern: feature-flagged
date: 2026-11-20
parent: 0023
---

# Idea 0068: Follow up: Bring a writer's pull request up to date with main without a main-session message
