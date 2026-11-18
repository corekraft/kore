---
summary: Review role-worktree blocks for false positives on cd and node -e
hypothesis: If role-worktree stopped blocking legitimate cd into read-only paths and node -e one-liners that stay inside the worktree, writers lose fewer turns to retries
expected-outcome: role-worktree blocks fall from 12 to under 4 with no escape from the worktree
measurement: guardBlocksByRule.role-worktree in harness flow report
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: guardBlocksByRule.role-worktree
hypothesis-direction: down
hypothesis-window: 14d
---

# Idea 0033: Review role-worktree blocks for false positives on cd and node -e
