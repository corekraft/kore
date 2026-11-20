---
summary: Let read-only roles run the git and gh reads they need
hypothesis: If role-read-only allows git fetch, merge-base, cat-file, ls-tree and ls-remote, which, command -v and harness --help, and judge.md names the reads that work, judges stop retrying blocked reads and friction falls.
expected-outcome: role-read-only blocks fall from 281 in 108 of 261 judge sessions (2026-11-12 to 2026-11-16) to under 30, and the judge block message stops saying a read changes files.
measurement: guardBlocks for role-read-only and friction.total in harness flow report.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: friction.total
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/801
outcome: refuted
---

# Idea 0013: Let read-only roles run the git and gh reads they need

## Outcome

- Result: refuted
- Kind: experiment
- Source: comparison
- Evidence: Mac ledger: role-read-only blocks ran at 95 a day (441) from 2026-11-12 to 2026-11-16T15:15Z, 76 a day (307) after the change merged, and 103 a day (278) over 2026-11-18..20; target under 30
- Recorded: 2026-11-20

Role-read-only blocks stayed between 76 and 103 a day, against a target under 30; follow-up is idea 0031.
