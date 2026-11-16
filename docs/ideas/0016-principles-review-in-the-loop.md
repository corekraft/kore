---
summary: Run principles-review in the delivery loop or archive it
hypothesis: If the judge runs the principles-review agent on each diff before approving, AGENTS.md rule breaks are caught before merge rather than after, and send-backs move earlier; if it adds nothing, archiving it removes an unused definition.
expected-outcome: principles-review moves from 0 launches in 728 sessions to one per judged PR, or is archived; send-backs per idea fall.
measurement: rework.sendBacksPerIdea in harness flow report, with agents.launched from hook retro-scan.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: rework.sendBacksPerIdea
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/804
---

# Idea 0016: Run principles-review in the delivery loop or archive it
