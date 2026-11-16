---
summary: Keep the main session's waits off its own turn
hypothesis: If the guard flags a foreground sleep, until or seq polling loop in the main session and names harness pr checks --wait, a background run or Monitor instead, owner messages and pane results stop queuing behind the orchestrator's waits and the owner re-asks less.
expected-outcome: Owner minutes per merged change fall by a quarter; in the retro window the main session's foreground poll time (about 490 minutes over 15-16 Nov, 669 calls) falls below 60 minutes, and the p90 queue wait of owner messages (33 minutes) falls below 5.
measurement: flow report outcomes.ownerMinutes.perMerged over 14 days, read beside a retro-scan count of the main session's foreground poll calls and queue-operation wait times.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: outcomes.ownerMinutes.perMerged
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0019: Keep the main session's waits off its own turn
