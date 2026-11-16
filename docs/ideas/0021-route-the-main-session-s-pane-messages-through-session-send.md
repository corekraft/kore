---
summary: Route the main session's pane messages through session send
hypothesis: If the guard blocks raw herdr agent prompt and pane send-text from the main session and names session send, and retro-scan counts the main session in bareCommands, every orchestrator follow-up carries a sender line, panes stop reading it as the owner's, and the retro stops counting it as an owner correction.
expected-outcome: Main-session raw herdr prompts (40 against 5 session send over 15-16 Nov) fall to zero, and the retro's repeated corrections that are orchestrator follow-ups (the top four clusters, 26 sessions) fall to none.
measurement: flow report rework.mainFollowUpsPerWriterSession over 14 days, which today misses the raw herdr prompts and should rise to their true count, read beside retro-scan bareCommands with the main session included.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: rework.mainFollowUpsPerWriterSession
hypothesis-direction: up
hypothesis-window: 14d
---

# Idea 0021: Route the main session's pane messages through session send
