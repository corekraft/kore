---
status: accepted
summary: A judge approve command posts the approving review the ruleset requires, and the role guards allow it and no raw gh pr review.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0109: The judge approves a pull request through its own tool before it merges

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 6](../../infra/plans/11-agent-delivery-loop.md#step-6-orchestrator-and-concierge)

Refines: ADR 0096, [ADR 0091](0091-containment-comes-from-identities-and-a-sandbox-not-role-guards.md)

## Context

ADR 0091 moves containment to identities and the `main` ruleset, and ADR 0096
gives the judge its own token. The ruleset then requires one approval, but the
judge had no way to give one: `harness judge merge` only merges, and the role
guards refuse a raw review command for every role. Once the ruleset syncs, every
judge merge would be refused for want of an approval.

## Decision

`harness judge approve <pr>` is the judge's one review. It re-runs the precheck
and, only when it passes, posts an approving review with the pane's own `gh`
identity, never an overridden one. It refuses a head that moved since the
verdict, refuses a PR authored by the same login as the caller, and posts
nothing when the caller already approved that head. The role guards allow this
command for the judge alone; a raw review command stays blocked for every role.
The judge approves, then runs `judge merge`, which stays the only merge.

## Consequences

- The approval comes from the judge's identity after a passing precheck, so the
  ruleset's approval means the precheck passed at that head.
- The review command has no commit flag, so a push between the head check and
  the review is a narrow window. The ruleset's up-to-date and stale-review
  rules, and the merge's `--match-head-commit`, still refuse a head nobody
  verified.
- A writer and the judge must be different logins; the same login refuses.
