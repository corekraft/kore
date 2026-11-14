---
{
  "summary": "Ten findings from the Matt Pocock-skill retro of 2026-11-14 over 193 main-checkout and 290 writer-worktree sessions, each with evidence and a proposed change; proposals only, none applied. Read when choosing which harness changes to accept.",
  "date": "2026-11-14",
  "last-verified": "2026-11-14",
}
---

# Pocock retro, 2026-11-14

**These are proposals only. None is applied. The owner picks which to accept.**

The retro ran on 2026-11-14 over 193 main-checkout sessions and 290
writer-worktree sessions since the last retro on 2026-11-12. Findings are listed
most severe first. Numbering and file:line evidence are as the retro reported
them. Open items are tracked on #417.

## 1. Judges cannot read the diff for just some files (tool economy, guard false positives)

About 220 failed calls: 178 `role-read-only` blocks still happened after #505,
plus about 40 failures from `gh pr diff N -- <path>`, a form `gh` does not have.

Judges try per-file diffs every way they can:

- An awk filter on the diff header lines is refused because `AWK_RUNS`
  (`tools/harness/src/hook/guard-role-allow.ts:135`) treats regex alternation as
  a pipe.
- A `sed -n` script with two print ranges separated by a semicolon is refused
  because `SED_PRINT` (`:117`) accepts one address only, and escaped slashes are
  refused too.
- Redirecting the diff to a scratch file and `git fetch` are refused by design.

Evidence: sessions 6907987f, 7589cc21, df360a08, a3c35270 among others.
`judge.md` step 1 says only to read the diff with read-only `gh` and `git`
commands.

Proposed:

- Add a read-only `harness judge diff <pr> [--path <glob>...] [--stat]` built on
  `judge/diff.ts`, and name it in `judge.md` step 1.
- Narrow `AWK_RUNS` to the forms that really run or write: print redirected to a
  file, print piped to a command string, `getline`, `system`.
- Allow semicolon-separated `sed -n` print scripts.

## 2. The role-worktree guard checks relative paths from the wrong directory (automated check broken)

`outside()` calls `resolve(root, path)` at `guard-role-delivery.ts:169`, which
resolves from the worktree root instead of the hook's cwd. So `cd ../..` from
`<wt>/tools/harness`, landing inside the worktree, is refused. `cd ../..` alone
was refused 78 times, 57 from a subdirectory (adr-domain-writer,
bare-glob-patterns and others). The same bug hits relative `git -C ../..` and
`sed -i ../src/x`.

Proposed: resolve against the hook's cwd, follow any earlier `cd` in the same
command, failing spec first.

## 3. Writer and orchestrator definitions tell agents to use tools they do not have

Both say to load Monitor first with ToolSearch, but neither `tools:` list
includes Monitor or ToolSearch. 89 writer sessions hit "No such tool available:
Monitor/ToolSearch/TaskStop" and then tried sleep loops, which Claude Code
blocks (about 40 more errors).

Proposed: add Monitor and ToolSearch to those `tools:` lists, or delete the
section. Add a test that fails when an agent body names a tool its `tools:` list
leaves out.

## 4. zsh quoting blocks are frequent and the memory about them changes nothing

- 254 + 37 unquoted-glob blocks, almost all `grep` with an include option given
  a bare star-dot-ts glob.
- 89 + 5 equals-word blocks, all `echo` of a separator made of equals signs.

The guard already prints the corrected command, but each block costs a retry.
The `zsh-quote-globs` memory loads in every session, yet the blocks continued.

Proposed: for these two exact shapes, have the guard return `updatedInput` with
the quoted word instead of blocking, then delete the `zsh-quote-globs` memory.

## 5. Principles-review verdicts are posted by hand; `harness review post` was never used (pointer in the wrong place)

The only instruction to use `review post` is in `principles-review.md` (the
caller posts), which the caller never reads. In session 112bd8fe, 124
hand-written `gh pr comment` principles-review calls came after #519 merged at
09:39Z and 48 before; `review post` was used 0 times.

Proposed: a guard rule that refuses `gh pr comment` with a principles-review
body and names `harness review post`. Have the reviewer end its report with the
exact `review post` command.

## 6. Judges are spawned before a PR is ready to judge (automated checks)

21 of 118 PRs needed more than one judge session, about 28 extra sessions.
Causes:

- CI still pending (#484).
- Branch conflicted with main (#517, #534).
- PR body declared no safety pattern (#436, #607) or one the diff did not match
  (#444, #450).
- Judge main checkout or harness bundle behind origin/main (#554, #504).

Proposed:

- A CI job that fails a PR body without exactly one valid `Safety pattern:`
  line, reusing the precheck parser (no workflow checks it today).
- The orchestrator runs the read-only judge precheck first and spawns a judge
  only when it passes.
- The precheck fails fast when local `tools/harness` is behind origin/main.

## 7. `session notify` types into the owner's pane and submits their half-written message (information access)

The owner's messages were cut mid-word at least three times (for example "is PR
584 not gonna ge" followed by a herdr finished line); at 18:06 the owner retyped
it. `notify` reported "Delivery not confirmed" 28 times. The user said "go read
panes. they can't seem to send".

Proposed: `session wait` is already the source of truth, so make `notify` skip
submitting when the target pane has unsent input, or deliver without typing into
the pane.

## 8. The ledger is missing outcome signals

Nothing runs `ledger poll-github` or `ledger poll-herdr` on a schedule or hook.
The last `pr.merged` event is 11-12 20:06 though about 100 PRs merged on 11-14,
and there are no `pane.*` events at all. Plan 12's metrics (#354) depend on
them.

Proposed: run `ledger poll-github` from a SessionStart or Stop hook (one poll at
a time is already enforced) or on a timer.

## 9. Pre-commit is still off with nothing left to justify it (guardrail missing; needs the owner)

`core.hooksPath` is `.git/hooks-light` and the keeper loop (pid 60557) still
resets it every 20 seconds. The conversion writers it was turned off for are
finished (plan 14: no agent work owed).

Proposed, with the owner's OK: kill the loop, run
`git config core.hooksPath tools/kore/.husky/_`, delete `.git/hooks-light` and
its memory.

## 10. The owner keeps asking the same status questions (tool economy)

In 112bd8fe: "progress vs goal" about 10 times at 5-55 tool calls each, "wake
panes" about 10 times, battery and load questions 7 times with 34 `pmset`
calls. The owner had to point out finished-but-open panes twice. `harness
status` was used once against 376 pane reads.

Proposed: proposal truncated in the retro output.
