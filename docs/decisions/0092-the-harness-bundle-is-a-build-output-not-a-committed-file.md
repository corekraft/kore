---
status: accepted
summary: skills/bin/harness.mjs is no longer committed: CI and release build it, a launcher loads it and fails closed when absent, and the merge driver and freshness check go.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0092: The harness bundle is a build output, not a committed file

Source: [`infra/plans/8-harness-measurement.md` § Step 1](../../infra/plans/8-harness-measurement.md#step-1-scaffold-the-harness-package)

Refines: [ADR 0082](0082-harness-package-bundled-for-skills.md)

## Context

[ADR 0082](0082-harness-package-bundled-for-skills.md) commits the bundle
`skills/bin/harness.mjs` so any clone runs the hooks without `npm ci`. Parallel
harness PRs each rewrite that one generated file, so every merge of a sibling
forces a rebase. The retro of 2026-11-12 counted 98 force-pushes across 55 of
89 PRs, most of them only to rebuild the bundle. The merge driver added in
#286 did not help: 1.14 force-pushes per PR before it, 1.03 after, because
GitHub's server-side merge never runs it.

## Decision

The bundle is a build output. It is not committed and `skills/bin/harness.mjs`
is git-ignored. CI builds it (`mise run harness-build`) before any step that
runs it, and a release that ships skills builds it the same way. No release
workflow ships the bundle today, so there is nothing to change there yet; the
first one that does must build it.

Hooks do not call the bundle directly. They run `.claude/hooks/harness.sh`, a
small committed launcher. It loads the bundle from `$KORE_HARNESS_BUNDLE` when
that is set, and from the worktree's `skills/bin/harness.mjs` otherwise.
`KORE_HARNESS_BUNDLE` is the seam for the writer sandbox in #337, which points
it at a read-only copy outside the worktree. When it is set it is the only
candidate, so a path that points nowhere never falls back to a bundle the pane
could have written itself. The shared location itself is chosen in #337.

The launcher fails closed. Claude Code blocks a tool call only on exit 2, so
for the `guard` hook every failure becomes exit 2: a missing bundle, a crash, a
syntax error, or a missing node (127). A deliberate block stays 2 and an allow
stays 0. Other hooks exit 1 on a missing bundle and pass the bundle's own exit
code through, so a missing build is loud without trapping a session, for
example in a Stop hook that would refuse to let it end. The hint says the
build runs in a terminal outside the session, because inside it the guard
blocks the fix itself.

The build writes the bundle beside its destination and renames it into place,
so a hook that reads it mid-build sees a complete file, never a truncated one
the guard would fail open on. The mise tasks that call the bundle go through
the launcher too, so they get the same hint.

The merge driver, `tools/harness/merge-driver.sh`, its registration task and
its `.gitattributes` line are removed, and so is the bundle-freshness check.
The harness test run builds the bundle before it starts.

### Making the bundle exist without a manual step

- `session spawn --worktree` installs `tools/harness` and builds the bundle
  before it splits the pane, so a new writer's first tool call is allowed. A
  failed install or build stops the spawn with the fix.
- The husky `post-merge` hook rebuilds the bundle after every pull, and
  `post-checkout` builds it when a branch checkout, such as the start of a
  rebase, finds none. Both ignore a
  failure and print the fix: a hook must never fail a git operation. Merging
  this change deletes the tracked bundle from every checkout on `git pull`;
  `post-merge` is the step that puts it back, so sessions in the main
  checkout keep working. The hooks arrive with the same merge, and husky
  installs them through `npm ci` in `tools/kore`, which every checkout has run.
- A worktree made by hand with `git worktree add` runs no hook: it has no
  `tools/kore/.husky/_` yet, so git finds nothing to run. Run
  `npm ci --prefix tools/kore`, then `npm ci --prefix tools/harness` and
  `mise run harness-build`. Session spawn does this itself.
- A branch that already rewrote the old bundle in a commit hits a one-time
  modify/delete conflict on rebase. Resolve it with
  `git rm --cached skills/bin/harness.mjs` and `git rebase --continue`; the
  bundle is rebuilt by the hooks, never merged.

### Tampering

An ignored file shows no diff, so a change to the bundle is invisible to review
where the committed file was visible. A pane that can write the bundle can
weaken the guard that runs from it. This is a real risk. It is covered by
#335, which blocks writer writes to the guard bundle, and by #337, which loads
the guard from a read-only path outside the worktree through
`KORE_HARNESS_BUNDLE`. No new path rule is added here, because ADR 0091 treats
regex role guards as hints.

## Consequences

Two harness PRs conflict only when a source file really conflicts. The
bundle is never reviewed or rebased. This reverses 0082's promise that any
clone runs the tools without `npm ci`: a fresh worktree has hooks that block
the guard until the first build, and the hint says how. A stale local bundle
is possible after pulling harness changes outside git's hooks; run
`mise run harness-build`, or any harness test run, which rebuilds it. Nothing in the repository proves a
bundle is current, because CI always builds its own from source.
