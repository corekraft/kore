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
outcome: confirmed
---

# Idea 0011: Stop guard blocks that hit legitimate work

## Notes from the 2026-11-16 retro

- **role-worktree takes the shell's cwd as the worktree root.** After a writer runs `cd tools/kore`, its `cd ../..` back to the worktree root is blocked, and the message names `<worktree>/tools/kore` as the worktree; reproduced against `hook guard` on main at af335d16. This accounts for at least 130 of the writer blocks (`cd ../..` 94, `git -C ../..` 13, `cd ..`, `cd ../harness` and `cd ../kore` 25). Resolve paths against `git rev-parse --show-toplevel` of the launch worktree, not the hook's cwd. `node -e` scripts that only read a file in the session scratchpad are blocked too (part of 53 `node -e` blocks); reads outside the worktree need not be.
- **Alternative to rewriting globs and equals words: run the Bash tool in bash.** Setting `CLAUDE_CODE_SHELL` to bash in the project settings `env` (verify the host honours it first) removes the class behind unquoted-glob, equals-word and the 876 bare-glob warnings, and retires the zsh-only quoting rules agents carry. The guards then need to know the shell, or retire.

## Outcome

- Result: confirmed
- Kind: experiment
- Source: comparison
- Evidence: ledger guard blocks, retro scans 2026-11-14..16 vs 2026-11-18..20: role-worktree 421->46, unquoted-glob 420->13, equals-word 116->11; 957 blocks in ~4 days to 70 in ~2.4 days
- Recorded: 2026-11-20

The three named guard rules fell about 88% per day (957 blocks in about 4 days to 70 in about 2.4 days).
