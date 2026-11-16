---
status: proposed
summary: Proposed, refines ADR 0117: a question that carries a recommendation goes to a read-only advisor role that records its decision on the issue, unless it is a reserved decision from a closed, fail-closed list whose entries already belong to the owner; the advisor grants nothing, reserved questions are posted at once and notified in one daily digest, and the advisor's tier is open for the owner.
date: 2026-11-16
last-verified: 2026-11-16
---

# ADR 0120: Recommended decisions go to an advisor, reserved decisions to the owner

Source: [idea 0008](../ideas/0008-decision-advisor.md) (#795) and [`infra/plans/11-agent-delivery-loop.md` § Principles](../../infra/plans/11-agent-delivery-loop.md#principles)

Refines: [ADR 0117](0117-the-delivery-loop-s-role-set.md).

## Status

Proposed. It becomes accepted when the owner answers the advisor's tier (below).
The `decision-advisor` flag stays off until then.

## Context

Plan 11's one human gate says a person approves an idea and everything after
is autonomous. In four days 101 questions reached the owner after approval,
and the owner took the first, recommended option 94 times. Those questions,
not the gate, were the departure from the plan. The advisor brings practice
back to the principle; it adds no gate.

## Decision

- **The advisor.** A read-only role decides a question that carries a
  recommendation and records the decision on the idea's issue. It hands reads
  to reader panes, so its own context stays small. Its decision grants no
  permission: the asking pane's guards, deny rules and consent gates apply as
  before, and a decision never stands in for consent (AGENTS.md, a tagged line
  is not approval; ADR 0091).
- **Reserved decisions stay with the owner.** The list is closed and kept with
  the advisor. Each entry already belongs to the owner:
  - any destruction (AGENTS.md, Destruction requires consent);
  - a guardrail's mode ([ADR 0080](0080-guardrails-change-freely-activate-with-approval.md));
  - credentials and identities (AGENTS.md, Secrets; plan 11, Current Limits);
  - accounts, external services and any action outside the repository, and
    spend (the owner's standing rules);
  - turning a flag on (AGENTS.md, It just works; ADR 0077);
  - dispatching a release or a live workflow, and merging a change outside the
    four patterns that merge without asking (the owner's standing rules);
  - approving a non-harness idea (plan 11, one human gate; ADR 0117);
  - reversing or superseding an accepted ADR. A refinement that contradicts no
    sentence of an accepted Decision section is not reserved;
  - anything the owner has explicitly parked, such as restoring pre-commit
    (#417).
  - the advisor's own definition, tier, reserved list, router, matcher and
    digest (content and timing), in either direction: plan 12 keeps the loop
    unable to weaken its own guardrails, and ADR 0080 treats a stricter rule
    like a looser one. The matcher names these files, so a question that cites
    them or an action that edits them routes to the owner; a proposal to add a
    pattern or a category is a non-blocking reserved question with its
    evidence.
- **Routing fails closed.** A question is unreserved only when the category
  the asking pane declares and deterministic matches on the question and its
  proposed action both say so; any match routes it to the owner. The matcher
  reuses existing guard patterns as a library and adds no guard rule
  (ADR 0091). It is a backstop, not the boundary: it will miss a reworded
  question. The advisor may escalate a question to the owner, never downgrade
  one.
- **Reserved questions are posted at once and notified once a day.** Each is a
  comment on its issue with an existing label, so the queue stays the only
  channel; status lists open ones, blocking first. One digest a day at most
  notifies the owner, never by typing into a pane. The tick, not the asking
  pane, marks a question blocking from the ledger, and keeps advancing other
  ideas. Consent for a destructive command is never routed: it stays inline
  with its gate, and an unsupervised pane that meets one stops and reports.
- **Measured from sources the router does not write.** A hook records an event
  whenever a session asks the person or ends a turn waiting on them. The
  primary metric is owner-facing questions outside the reserved list per merged
  change, target 0. Quality is overturned decisions over decisions made;
  above about 7 percent the advisor does worse than always taking the
  recommendation (94 of 101). Stage events carry the route, category and idea
  only; the question and the reasoning stay on the issue.

## Open for the owner

- **The advisor's tier.** The owner's direction of 2026-11-16 makes Opus the
  advisor of the Sonnet orchestrator. ADR 0117 defines every role on Haiku or
  Sonnet with a definitions test that fails on any other model, and the stored
  rule of 2026-11-13 keeps spawned panes on Haiku or Sonnet; that rule once
  carried an exception for retro on Opus, which ADR 0117 moved to Sonnet. The
  role is built with its tier as one line of frontmatter, on Sonnet at high
  effort only because the test allows that today.
- **Flag activation for harness-only flags** stays reserved; moving it to the
  advisor is a separate owner question.

## How this was decided

By recommendation in a grilling session on ideas 0007 to 0016 on 2026-11-16,
answered on the owner's behalf by another session. The digest interval, the
matcher's patterns and the 7 percent figure are placeholders.
