---
summary: Guards read command words, not script or body text
hypothesis: If role-no-merge stops reading heredoc and --body text as commands and lets --help through, and role-worktree stops reading sed -i, perl -pi and node -e script text as paths, writer blocks on legitimate work fall to near zero
expected-outcome: Since 2026-11-12, about 26 of 28 writer role-no-merge blocks were legitimate (24 heredoc or PR body text that named harness flag activate, 2 --help), and 14 of 20 role-worktree blocks after #845 were sed -i, perl -pi or node -e script text inside the worktree. Each falls to at most 2 legitimate blocks in 14 days, and friction.total falls with them
measurement: friction.total and guardBlocks for role-no-merge and role-worktree in harness flow report; retro-scan --evidence classifies the blocks that remain
safety-pattern: feature-flagged
date: 2026-11-17
kind: harness
hypothesis-metric: friction.total
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/964
---

# Idea 0022: Guards read command words, not script or body text
