---
summary: Writers run the judge precheck before they report done
hypothesis: If a writer runs the read-only judge precheck on its own pull request and fixes the declaration or the diff before its RESULT line, the judge sends fewer changes back.
expected-outcome: Failed prechecks fall from 170 of 426 (40 percent) to under 15 percent, and send-backs per idea fall.
measurement: rework.sendBacksPerIdea in harness flow report, with the precheck pass and fail labels counted from precheck ledger events.
safety-pattern: no-behaviour-change
date: 2026-11-16
kind: harness
hypothesis-metric: rework.sendBacksPerIdea
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/797
---

# Idea 0010: Writers run the judge precheck before they report done
