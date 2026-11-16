---
summary: Carry a pane's result summary in its session state file
hypothesis: If session notify writes the pane's result summary into .kore/state/sessions/<name>.json beside result.outcome, the caller reads results from the file filtered by callerPane, not by scraping the pane with herdr agent read and PageDown keys, and orchestration spends fewer tokens per idea.
expected-outcome: Main-session herdr agent read calls (278 over 15-16 Nov) fall by three quarters, and tokens per idea fall.
measurement: flow report metrics.tokensPerIdea over 14 days, read beside a retro-scan count of the main session's herdr agent read and send-keys calls.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: metrics.tokensPerIdea
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0020: Carry a pane's result summary in its session state file
