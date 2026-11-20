---
summary: Follow up on idea 0010 after a refuted outcome
hypothesis: After a refuted outcome on idea 0010, revisit: If a writer runs the read-only judge precheck on its own pull request and fixes the declaration or the diff before its RESULT line, the judge sends fewer changes back.
expected-outcome: Failed prechecks fall from 170 of 426 (40 percent) to under 15 percent, and send-backs per idea fall.
measurement: rework.sendBacksPerIdea in harness flow report, with the precheck pass and fail labels counted from precheck ledger events.
safety-pattern: no-behaviour-change
date: 2026-11-20
parent: 0010
---

# Idea 0058: Follow up: Writers run the judge precheck before they report done
