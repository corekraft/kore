---
status: accepted
summary: Deterministic harness tools live in a TypeScript package at tools/harness, built with the same TDD and domain discipline as tools/kore, bundled to one committed skills/bin/harness.mjs, and talking to kore only through its CLI output and journal format.
date: 2026-11-11
last-verified: 2026-11-11
---

# ADR 0082: Harness tools are a TypeScript package bundled for skills

Source: [`infra/plans/8-harness-measurement.md` § Step 1](../../infra/plans/8-harness-measurement.md#step-1-scaffold-the-harness-package)

Refines: [ADR 0001](0001-kore-typescript-cli.md) and the hook layout from
[`infra/plans/3-agent-harness.md`](../../infra/plans/3-agent-harness.md).

## Context

Skills ask the model to perform deterministic steps by hand: numbering ADRs,
updating the index, splitting panes, recounting plan items. That costs tokens
and invites mistakes, and it keeps cheap models from running the loop. The
existing hooks are about 2,500 lines of untyped `.mjs` tested with
`node --test`, outside the domain and coverage discipline `tools/kore`
follows.

## Decision

Deterministic harness work lives in a TypeScript package at `tools/harness`.
It uses the same toolchain as `tools/kore`: strict TypeScript, oxlint with
`--deny-warnings`, prettier, vitest in parallel, and a coverage ratchet. It
follows the same domain rules: one cohesive class per responsibility, an
injectable runner for side effects, and a small `index.ts` per domain. Domains
are named with glossary terms.

The package is bundled with esbuild, pinned as a dev dependency, into one
dependency-free file, `skills/bin/harness.mjs`, which is committed. Skills and
hooks call it as `node skills/bin/harness.mjs <domain> <command>` with JSON
output. CI rebuilds the bundle and fails if it differs from the committed file.
The existing hooks move into the package, behaviour first.

The harness never imports `tools/kore/src`. It reads kore through the CLI's
machine-readable output and the documented journal format.

## Consequences

A skill becomes a short description plus tool calls. Any clone, worktree or
pane can run the tools without `npm ci`. The repository carries a generated
file, kept honest by the CI check. A second package means a second set of
toolchain pins to upgrade together.

## Note: merging the bundle (2026-11-12)

A committed generated file conflicts whenever two branches change the harness.
The decision above holds; a git merge driver (`harness-bundle`, set in
`.gitattributes`, registered per clone by `mise run setup-merge-driver`)
rebuilds the bundle from the merged sources during a local merge, rebase or
cherry-pick. GitHub's server-side merge runs no custom drivers, so a PR that
conflicts there still needs a local rebase, which the driver makes automatic.
CI still fails on a stale bundle. See the
[contributor guide](../guides/contributor.md#the-harness-bundle-and-merges).
