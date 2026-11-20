---
summary: Follow up on idea 0019 after a inconclusive outcome
hypothesis: After a inconclusive outcome on idea 0019, revisit: If the main session waits on pull request checks and pane results with one background harness wait instead of foreground sleep, until or seq loops, owner messages and pane results stop queuing behind its waits.
expected-outcome: The main session's foreground poll minutes per merged change fall by at least three quarters, against about 490 minutes in 669 polls over 15-16 Nov, while owner minutes per merged change and the p90 queue wait of owner messages (33 minutes) do not worsen.
measurement: mainSession.foregroundPollMinutesPerMerged in harness flow report, from the retro.main-session event retro-scan records from transcripts.
safety-pattern: feature-flagged
date: 2026-11-20
parent: 0019
---

# Idea 0064: Follow up: Keep the main session's waits off its own turn
