---
status: accepted
summary: A writer may create, edit, move and delete a hook test file directly in .claude/hooks, but the hook scripts, settings, the bundle and the .claude folder stay protected.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0100: Writers may edit hook test files, while the hooks stay protected

Source: [`infra/plans/14-test-tiers.md` § Step 1](../../infra/plans/14-test-tiers.md#step-1-foundations)

Refines: ADR 0091

## Context

ADR 0091 freezes the role guards and treats `.claude/hooks` as protected. The
guard protects the hook scripts, and it also covers the hook test files
(`.claude/hooks/*.test.mjs`), which are not the guard. Writers could not fix a
leaking test fixture or move a test to the integration tier, so each change
needed a session started outside the guard.

## Decision

A writer may create, edit, move and delete a file directly in `.claude/hooks`
whose name ends in `.test.mjs`, through file tools and through Bash. The name
must be literal: a glob, variable, substitution, path climb or a path outside
this worktree stays protected, and so does a command that also names a
protected file. Every other file under `.claude/hooks`, the settings files,
`skills/bin` and the `.claude` folder stay protected with the same refusal.
This loosens an enforced guard, so it is the owner's approval under ADR 0080,
recorded in #440 and in the `role-read-only` note of `.claude/guardrails.yaml`.

## Consequences

Test fixes under `.claude/hooks` no longer need a session outside the guard.
Inline code that names a hook test file (`node -e`) stays blocked, because
the guard cannot read what it writes; a writer names the file instead. The
hook scripts still need the owner.
