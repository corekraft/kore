---
summary: Cut main-session pane polling and raw sends
hypothesis: If the main session used signed sends and finish detection instead of raw sends and repeated pane reads (733 reads, 747 raw sends vs 4 signed in 2 sessions, 1340 poll minutes), polling cost falls
expected-outcome: signedSendShare rises from near 0 to above 0.5
measurement: mainSession.signedSendShare in harness flow report
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: mainSession.signedSendShare
hypothesis-direction: up
hypothesis-window: 14d
---

# Idea 0035: Cut main-session pane polling and raw sends
