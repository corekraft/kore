---
summary: Stop guard blocks that hit legitimate work
hypothesis: If the guard rewrites an unquoted glob or a bare equals word instead of blocking it, role-worktree stops reading heredoc text and relative paths as paths outside the worktree, and workers get a harness command that waits for CI, friction falls.
expected-outcome: Friction events fall by at least half, against 421 role-worktree, 420 unquoted-glob and 116 equals-word blocks, 135 blocked sleeps and 35 missing Monitor calls in the scanned sessions.
measurement: friction.total and guardBlocks per rule in harness flow report.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: friction.total
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/798
---

# Idea 0011: Stop guard blocks that hit legitimate work
