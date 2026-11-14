---
status: accepted
summary: Refines ADR 0078 and 0080: agent containment comes from separate GitHub identities, no owner bypass and an OS sandbox; regex role guards are hints, frozen apart from quick fixes.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0091: Containment comes from identities and a sandbox, not role guards

Source: [`infra/plans/11-agent-delivery-loop.md`](../../infra/plans/11-agent-delivery-loop.md)

Refines: [ADR 0078](0078-agent-roles-run-as-herdr-panes.md) and [ADR 0080](0080-guardrails-change-freely-activate-with-approval.md).

## Context

ADR 0078 runs each role as a Herdr pane and limits it with hooks and deny
rules. ADR 0080 lets those guardrails change automatically. The 2026-11-12
adversarial retro showed that regex guards over shell commands can be
sidestepped by a writer that wants to, and that every new guard adds surface
without adding a boundary. All roles also share the owner's GitHub identity,
and the owner can bypass `main` protection.

## Decision

- Writers and the judge get separate GitHub identities, each with only the
  permissions its role needs.
- The owner's bypass of `main` goes away; only the judge identity merges.
- Writer panes run in an OS sandbox.
- Guard hooks and deny rules stay as hints that give early, readable
  feedback. They are not the boundary. Their growth is frozen apart from quick
  fixes to an existing rule.

Until the judge identity exists, merges are by the owner's hand.

## Consequences

- Containment no longer depends on guessing every dangerous command shape.
- Harness work is limited to containment and metrics until the base is
  proven; new guards are not added.
- ADR 0080 still governs activation; its free change of guardrails is limited to quick fixes.
- Refined by [ADR 0101](0101-harness-developer-tools-may-make-deterministic-steps-tools-the-freeze-covers-guards.md): non-guard harness tools that make a deterministic step a tool are allowed.
