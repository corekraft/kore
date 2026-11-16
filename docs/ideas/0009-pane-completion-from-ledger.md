---
summary: Take pane completion from session wait and a watchdog timer
hypothesis: If a finished pane is detected from session wait and ledger poll-herdr on a timer that closes or restarts panes, with no text typed into another pane, ideas stop stalling on a lost finish line and lead time falls.
expected-outcome: Median lead time falls, failed session notify calls go from about 130 in four days to 0, and the owner sends no wake or cleanup message, against 29 such messages in four days.
measurement: leadTime.medianSeconds in harness flow report, with failed notify calls read from the retro-scan failures list.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: leadTime.medianSeconds
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/796
---

# Idea 0009: Take pane completion from session wait and a watchdog timer
