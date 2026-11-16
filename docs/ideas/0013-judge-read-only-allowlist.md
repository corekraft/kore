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
---

# Idea 0013: Let read-only roles run the git and gh reads they need
