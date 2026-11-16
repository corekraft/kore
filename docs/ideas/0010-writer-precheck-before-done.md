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

## Baseline (#841)

Read with `harness ledger list` from the precheck events, send-back events and
pull request checks between 2026-11-12 and 2026-11-16, before this idea's
change merges.

- Precheck events: 455, of which 184 failed (40.4 percent). The 170 of 426
  cited above does not reproduce from the ledger; it is reached at event 417
  of 455.
- Failures by declared pattern: no-behaviour-change 110 of 325; expand-contract
  33 of 70; feature-flagged 24 of 41; dark-launched 7 of 8; branch-by-abstraction
  3 of 4; no valid declaration 7 of 7.
- Failures by reason: the precheck event records only the pattern and pass or
  fail, not the reason. Its `none` label marks a declaration failure (7). The
  other 177 failures cannot be split into declaration, pattern-mismatch or
  failed-check from the ledger.
- Send-backs: 22 events, all uncategorised. Their reason text, read by hand:
  2 declaration, 12 pattern-mismatch, 2 failed-check, 3 conflict, 3 other. The
  writer-owned share (declaration and pattern-mismatch) is 14 of 22.

## Target

Not set. A writer-owned failure rate per PR head cannot be read from the
ledger until the precheck records its reason. The owner decides the number
(see #841).
