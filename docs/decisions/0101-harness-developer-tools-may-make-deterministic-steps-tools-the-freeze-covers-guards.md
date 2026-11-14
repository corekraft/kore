---
status: accepted
summary: Refines ADR 0091: non-guard harness developer tools that make a deterministic step a tool, such as posting the review verdict and removing a merged writer's worktree, are allowed; the freeze still holds for new guards, deny rules and rule families.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0101: Harness developer tools may make deterministic steps tools; the freeze covers guards

Source: [`infra/plans/11-agent-delivery-loop.md` § Current Limits](../../infra/plans/11-agent-delivery-loop.md#current-limits)

Refines: [ADR 0091](0091-containment-comes-from-identities-and-a-sandbox-not-role-guards.md).

## Context

ADR 0091 limits harness work to containment and metrics and freezes new
guards. Read literally, it also blocks tools that make a deterministic step a
tool, such as posting the principles-review verdict in the precheck's format
and removing a merged writer's worktree. Those steps add no guard and no
boundary, so the freeze was never meant to stop them, and #500 and #501 wait on
this answer. The owner decided on 2026-11-14 that the limit does not hold them
back.

## Decision

- Non-guard developer tools in `tools/harness` that make a deterministic step a
  tool are allowed. Examples: posting the principles-review verdict in the
  precheck's format, and removing a merged writer's worktree.
- The freeze in ADR 0091 still applies to new guards, new deny rules and new
  rule families.

## Consequences

- #500 (`harness review post`) and #501 (`session close --remove-worktree`) may
  start once this merges.
- A tool that starts enforcing a rule is a guard and falls under the freeze.
