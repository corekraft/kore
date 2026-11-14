---
summary: Findings of the repo-skill retro over 436 sessions from 2026-11-12 to 2026-11-14, as proposals only; none applied, the owner picks which to accept.
date: 2026-11-14
last-verified: 2026-11-14
---

# Repo Retro 2026-11-14

These are **proposals only**. None is applied. The owner picks which to accept.

The retro ran on 2026-11-14 over 436 sessions from 2026-11-12 to 2026-11-14.
Findings are listed most frequent first. The numbering and the `file:line`
evidence are as the scan reported them.

## 1. The role-worktree guard blocks `cd` moves that stay inside the worktree

73 of the 109 `cd` blocks, the latest at 19:29Z on 2026-11-14.
`tools/harness/src/hook/guard-role-delivery.ts:169` works out the `cd` target
from the worktree root instead of the session's cwd. From
`<worktree>/tools/harness`, `cd ../..` is blocked although it only returns to
the worktree root.

The same guard also reads regexes inside `node -e` code (such as
`/restrict|Pattern/i`) as absolute paths outside the worktree.

## 2. Read-only roles are blocked from some read commands

56 transcripts, all in `tools/harness/src/hook/guard-role-allow.ts`:

- `READER_GIT` has no `git fetch`, so judges and readers cannot fetch. Fix:
  allow it without a `:dst` refspec, `--upload-pack` or `-c`, or have
  `.claude/agents/judge.md` use `gh pr diff`.
- `SED_PRINT` accepts only one range, so a `sed -n` script with two print
  ranges separated by a semicolon is blocked (14 transcripts).
- There is no read-only `gh api` case, so `gh api user` with a `jq` login
  filter is blocked (3 transcripts).

## 3. The writer and orchestrator definitions tell agents to use tools they do not have

30 failures, the latest at 20:02Z on 2026-11-14. Line 29 of
`.claude/agents/writer.md` and `.claude/agents/orchestrator.md` says to load
Monitor through ToolSearch, but neither file's `tools:` line lists ToolSearch or
Monitor. Fix: add both tools, or delete that line in both files.

## 4. The same two guard blocks keep repeating

Both blocks are correct, but agents repeat the mistake:

- 264 unquoted-glob blocks, mostly `grep` with an include option given a bare
  star-dot-ts glob.
- 99 equals-word blocks, for bare separator words made of equals signs.

Option: for these two rules, have the hook swap in the corrected command
instead of blocking (PreToolUse `updatedInput`). Nothing in the harness does
this yet, so it needs an ADR first.

## 5. The scan's repeated-corrections list is mostly noise

The largest groups are follow-up instructions typed into worker panes, not the
user correcting an agent. Fix: add a step to `skills/spawn-session/SKILL.md` to
start every follow-up with `[orchestrator]`, which the scan already skips. Of
13 lines checked, none was a real correction worth a rule.

## 6. Small scan miscount

The one `image-digest` block and the one `audit-x` block both point to a line
that is really a `role-worktree` block.

Other blocks look like they stopped what they should, except one
`role-no-merge` block of `outcome record --help`. The three audit rules marked
not-promotable should stay as they are.

## No change proposed

- Nothing is ready to promote to an enforced rule.
- No skill went unused.
- No memory changes are proposed.

## Needed from the owner

Pick which items to accept. Accepted ones then go into
`infra/plans/3-agent-harness.md` or an ADR, and `Last retrospective:` is set to
the current UTC time. That is not done.
