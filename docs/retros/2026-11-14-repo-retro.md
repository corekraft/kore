---
summary: Findings of the repo-skill retro over 436 sessions from 2026-11-12 to 2026-11-14, unified with the Pocock retro into one triage the owner decided on #417; none applied yet.
date: 2026-11-14
last-verified: 2026-11-14
---

# Repo Retro 2026-11-14

These findings were proposals. The owner has since accepted the items below,
recorded on #417, comment of 2026-11-14. None is applied yet; each accepted item
goes in as its own writer PR.

## Unified triage and owner decision (2026-11-14)

This repo retro and the [Pocock retro](2026-11-14-pocock-retro.md) are triaged
together. Both retros found: the role-worktree `cd` false positive, gaps in the
read-only guard, the Monitor and ToolSearch tool-list mismatch, and repeated zsh
quoting blocks. Only this repo retro found: scan noise from follow-up messages,
and the scan tag miscount. Only the Pocock retro found: judge per-file diffs,
hand-posted review verdicts, early judge spawns, `session notify` typing over
the owner's input, missing ledger polling, pre-commit still off, and repeated
status questions.

The 12 merged items, with their status. Item numbers are the merged list's, not
the findings' numbers below.

**Accepted** (owner, #417):

- 1. The role-worktree guard resolves relative paths from the hook's cwd. 1b,
     `node -e` regexes read as paths, is deferred.
- 2. `session notify` never submits over unsent input.
- 3. Delete the "load Monitor via ToolSearch" line in `writer.md` and
     `orchestrator.md`. Do not add the tools: the guard only inspects Bash. Add an
     agent-definition tool-list test.
- 4a. A read-only `harness judge diff <pr> [--path] [--stat]`.
- 4b. Semicolon-joined `sed -n` print ranges.
- 5. The retro scan counts only a block message's leading guard tag.
- 6. The `spawn-session` skill: start follow-ups with `[orchestrator]`.
- 7. `principles-review` ends with the exact `harness review post <pr>` command.
     No new guard rule.
- 8. Ledger `poll-github`, built from the existing SessionStart hook code.
- 10a. `judge precheck` fails fast when the local harness is behind
  `origin/main`.
- 10b. A CI audit of the `Safety pattern:` line. Audit, not required.

**Rejected:**

- 4d. Allow `git fetch` for read-only roles. It writes refs into the shared
  `.git`, and 4a removes the need.

**Deferred:**

- 4c. Narrow `AWK_RUNS`.
- 4e. Read-only `gh api`.
- 10c. The orchestrator runs precheck before spawning a judge, after #332.
- 12. Repeated status questions. The proposal text was cut off in the retro.

**Owner-only, undecided:**

- 9. Zsh quote auto-rewrite through `updatedInput`. It needs an ADR; keep the
     `zsh-quote-globs` memory.
- 11. Restoring pre-commit (`core.hooksPath`, keeper loop pid 60557).

The accepted items go in as separate writer PRs under #417, in the order a, b,
c, e, d, f, g, h, which the owner gave as retro items 1, 2, 3, 5, 4b, 4a, 6/7,
8, 10.

## The six findings

The findings below are unchanged from the scan.

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

Evidence as reported by the retro: transcript counts, and the file `tools/harness/src/hook/guard-role-allow.ts` with the rule names `READER_GIT` and `SED_PRINT`; no line numbers given.

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

Evidence as reported by the retro: block counts only, no `file:line` given.

## 5. The scan's repeated-corrections list is mostly noise

The largest groups are follow-up instructions typed into worker panes, not the
user correcting an agent. Fix: add a step to `skills/spawn-session/SKILL.md` to
start every follow-up with `[orchestrator]`, which the scan already skips. Of
13 lines checked, none was a real correction worth a rule.

Evidence as reported by the retro: counts only, no `file:line` given. `skills/spawn-session/SKILL.md` is the proposed fix location, not evidence.

## 6. Small scan miscount

The one `image-digest` block and the one `audit-x` block both point to a line
that is really a `role-worktree` block.

Other blocks look like they stopped what they should, except one
`role-no-merge` block of `outcome record --help`. The three audit rules marked
not-promotable should stay as they are.

Evidence as reported by the retro: counts only, no `file:line` given for the miscounted blocks.

## No change proposed

- Nothing is ready to promote to an enforced rule.
- No skill went unused.
- No memory changes are proposed.

## Still open

The owner has decided the items above except 9 and 11. Accepted ones go into
`infra/plans/3-agent-harness.md` or an ADR as their PRs land, and
`Last retrospective:` is set to the current UTC time. That is not done.
