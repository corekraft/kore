---
status: proposed
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

The launcher fails closed. With no bundle, the `guard` hook exits 2, which
blocks the tool call, and prints the fix: `npm ci --prefix tools/harness` then
`mise run harness-build`. Other hooks exit 1 with the same hint, so a missing
build is loud without trapping a session, for example in a Stop hook that
would refuse to let it end.

The merge driver, `tools/harness/merge-driver.sh`, its registration task and
its `.gitattributes` line are removed, and so is the bundle-freshness check.
The harness test run builds the bundle before it starts, so a fresh worktree
needs only `npm ci --prefix tools/harness`.

## Consequences

Two harness PRs conflict only when a source file really conflicts. The
bundle is never reviewed or rebased. This reverses 0082's promise that any
clone runs the tools without `npm ci`: a fresh worktree has hooks that block
the guard until the first build, and the hint says how. A stale local bundle
is possible after pulling harness changes; run `mise run harness-build`, or
any harness test run, which rebuilds it. Nothing in the repository proves a
bundle is current, because CI always builds its own from source.
