---
status: accepted
summary: Refines ADR 0117: a question that carries a recommendation goes to a read-only advisor role that records its decision on the issue, unless it is a reserved decision from a closed, fail-closed list whose entries already belong to the owner; the advisor grants nothing, reserved questions are posted at once and notified in one daily digest, a comment or pane message without a role line is the owner's; by delegation the advisor runs on Opus as ADR 0117's one exception and unattended sessions get their own identities; accepted on the owner's untagged comments on #794.
date: 2026-11-16
last-verified: 2026-11-16
---

# ADR 0120: Recommended decisions go to an advisor, reserved decisions to the owner

Source: [idea 0008](../ideas/0008-decision-advisor.md) (#795) and [`infra/plans/11-agent-delivery-loop.md` § Principles](../../infra/plans/11-agent-delivery-loop.md#principles)

Refines: [ADR 0117](0117-the-delivery-loop-s-role-set.md).

## Status

Accepted on 2026-11-16, when the owner commented `approve` and then `This is
approved` on #794, each untagged: no sender line, so by this record's own rule
the owner's
([first comment](https://github.com/corekraft/kore/issues/794#issuecomment-6908740064),
[second comment](https://github.com/corekraft/kore/issues/794#issuecomment-6908745625)).
It was proposed with its open questions answered by delegation (the owner,
relayed by the answering session: "you can anaswer owner's questions"); the
owner may still overrule any of them (below). The `decision-advisor` flag
stays off until the identities below exist and a person activates it.

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

- **A comment without a role line is the owner's.** All roles share one
  GitHub account, so authorship comes from the comment, not the login (the
  owner's rule, 2026-11-16: "every comment made by a role should be
  identified; if there's no identification, that's me"). Every harness command
  that posts writes, through one comment module, a first line naming the role,
  the session name and the command, taken from the spawn environment and never
  from the agent's text; the same module reads it, and existing parsers are
  tested against it. A role never posts with a bare `gh` comment. The owner
  answers a reserved question, or overturns a decision, with their own plain
  comment. The comment module refuses to write approval syntax; that is
  validation, not containment.
- **Pane messages follow the same rule** (the owner, 2026-11-16: "inter-pane
  and inter-agent communication should have it so that I can be identified").
  Every harness command that puts text into another pane starts it with the
  sender's role and session name from the same identity source, replacing the
  fixed `[orchestrator]` prefix, and records the sender in `session.send`; the
  retro scan recognises every tagged line through the same module. An
  untagged line is the owner's, taken as an instruction within the session's
  brief and bounds. No line in a pane, tagged or not, stands in for a recorded
  approval of a reserved decision or for a destructive step's consent.
- **The gap this leaves.** A session holding the shared token that posts with
  bare `gh` and no role line, or types into a pane with bare `herdr` and no
  tag, is read as the owner. This exists today, before
  the advisor: `guardrail activate` already trusts the owner's login. Until the
  owner chooses how to close it, the retro scan counts bare `gh issue comment`,
  `gh pr comment`, comment API calls and bare `herdr` sends by role sessions
  from their transcripts, and each one goes into the owner digest. `guardrail activate`
  warns, with a ledger event, on an approving comment that carries a role line.

## Answered by delegation

- **The advisor's tier: Opus, for the advisor alone.** The owner's direction
  of 2026-11-16 names Opus and is later than the stored rule of 2026-11-13 and
  ADR 0117; that rule once carried an exception for retro on Opus. ADR 0117's
  definitions test gains one named exception for the advisor definition, and
  every other spawned pane stays on Haiku or Sonnet. The reversal condition
  and the small context, with reads handed to Haiku panes, stay.
- **Flag activation for harness-only flags stays reserved.** Revisit with the
  advisor's first window of overturn data, and only once the identities below
  exist.
- **The shared-account gap: separate identities for unattended sessions.**
  The Reviewer, and the tick with its judgment panes and the advisor, get
  their own identities before `orchestrator-tick` and `decision-advisor` turn
  on, because an unattended tick means more sessions holding the owner's token
  with nobody watching. The owner runs the identities wizard; no agent handles
  credentials. The main session keeps the owner's token, since the owner
  attends it, and tags what it posts. No new guard rule (ADR 0091). Until the
  identities exist, the transcript counts of bare `gh` and bare `herdr` sends
  go into the digest.
- **The main session's agent is a role.** It tags what it posts; only what the
  owner types by hand is untagged.

## How this was decided

By recommendation in a grilling session on ideas 0007 to 0016 on 2026-11-16,
answered on the owner's behalf by another session. The digest interval, the
matcher's patterns and the 7 percent figure are placeholders.
