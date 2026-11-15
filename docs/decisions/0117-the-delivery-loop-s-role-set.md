---
status: accepted
summary: Refines ADR 0078 and ADR 0091: the delivery loop runs on writer, judge, reader and a spawned Reviewer; the orchestrator, concierge, refiner and challenger definitions are removed (never launched since the ledger began on 12 Nov 2026), the Orchestrator role is filled by orchestrate run, every role is defined on Haiku or Sonnet, the auto-approve qualifier replaces the challenger for harness ideas, and spawn-session is deleted.
date: 2026-11-15
last-verified: 2026-11-15
---

# ADR 0117: The delivery loop's role set

Source: [`infra/plans/11-agent-delivery-loop.md`](../../infra/plans/11-agent-delivery-loop.md)

Refines: [ADR 0078](0078-agent-roles-run-as-herdr-panes.md) and [ADR 0091](0091-containment-comes-from-identities-and-a-sandbox-not-role-guards.md).

## Context

ADR 0078 gave each delivery-loop role an agent definition and a Herdr pane.
Assessment #737 (spec #740) checked that set against the ledger, which began on
12 Nov 2026:

- The orchestrator, concierge, refiner and challenger definitions have no
  launch in the ledger. Writers have 276 launches and judges 232. Only about
  two retro panes ran. Agent use before 12 Nov is not covered.
- Every step of `orchestrator.md` that is mechanical is already done by
  `orchestrate run`. Each answer the concierge gives runs an existing command
  (`status`, `flow report`, `idea new`).
- 133 of 276 writer launches and 77 of 232 judge launches ran on Sonnet with no
  escalation recorded, and Opus ran in spawned panes against the owner's rule
  of Haiku or Sonnet.
- A failing precheck cost a judge pane to relay, although the precheck is
  deterministic.
- The automatic retro pane only proposes, and after these removals no role may
  run `idea new`, so a retro finding could not become a harness idea.

Each removed definition still carries guard roles, boundary eval cases,
glossary terms, plan items and a flow stage that someone must maintain.

## Decision

- **Removals.** The orchestrator, concierge, refiner and challenger
  definitions are removed, with the challenge domain, `idea challenge`, the
  challenge stage and the Challenger rounds metric. The evidence is the launch
  counts above. Old `challenge.round` events still parse and count as unmapped
  events, and the append-only eval history is left as it is.
- **The Orchestrator is a role filled by a tool.** `orchestrate run` drives an
  approved idea to an outcome; no agent does. The person's own main session
  answers status and files requests through the existing commands. The queue
  (GitHub issues, labels and comments) is the only channel into
  `orchestrate run`.
- **Every role has a definition, on Haiku or Sonnet.** A definitions test fails
  on any other model. Verifier and fixer panes are briefed as reader or writer;
  they are pane names, not roles.
- **Retro and the Reviewer.** Retro runs on Sonnet at high effort. The Reviewer
  (principles-review) is a spawned role on Sonnet at medium effort. Both were
  decided by recommendation, not from data, and the owner may overrule them.
  Reversal conditions:
  - Retro returns to a larger tier if ideas from Sonnet retros are refuted at a
    clearly higher rate than before. The tier-source data makes that
    comparison possible.
  - The Reviewer's tier is revisited once `review run` records launches and the
    rate of passed reviews that are later sent back can be measured.
- **The qualifier replaces the challenger for harness ideas.** Before
  auto-approval, the qualifier refuses an idea that is not a harness idea, has
  a pattern outside the four reversible ones, moves a guardrail to enforce,
  names a metric missing from the flow report, or names a metric with no
  trailing average. For non-harness ideas the person's `ready-for-agent`
  label is the only gate. No independent check reads them. This is an
  **accepted risk**: a weak hypothesis or a wrong safety pattern on a non-harness
  idea reaches approval unchallenged, and the principles-review of the pull
  request and the judge are the later checks.
- **Removing guard rules is not guard growth.** ADR 0091 freezes new guards,
  deny rules and rule families. Dropping the removed roles from the guard role
  lists, and adding the Reviewer to the existing read-only and spawned lists,
  shrinks or extends existing rules and adds no rule. No item here adds a guard
  rule or a rule family, in line with ADR 0101.
- **Plans are reworded.**
  - Plan 11 Step 3 is marked superseded, not unticked: the refiner and
    challenger were built and then retired.
  - Plan 11's channel principle reads that the queue is the only channel into
    `orchestrate run`. Step 6's orchestrator item is reworded for
    `orchestrate run` with its exit criterion unchanged. The concierge item is
    rewritten for the person's main session and stays unticked until its proof
    is settled.
  - Plan 12 Step 2 reads that retro runs on Sonnet and proposes, and that
    `orchestrate run` files the proposals as ideas.
- **`spawn-session` is deleted** in favour of herdr's own skill
  (`herdr --skill`) plus the usage text of `session spawn`. The skill goes only
  after `session send` and pane-name validation have landed, so no rule ends
  up stated nowhere. The herdr version is pinned like any other tool, and no
  copy is vendored, because two owners of one text drift apart.
- **Precheck send-backs count as judge send-backs from 15 Nov 2026** (pull
  request #763 merged that day). `orchestrate run` runs the precheck before any
  judge pane and records a failing change as the existing judge send-back
  event, once per pull request head. Judge send-back counts from that date
  include precheck failures, so plan 12's baseline comparison shifts there and
  readers must not compare across it.
- **Placeholders are re-checked.** The retro cap of 5 ideas, the Reviewer's
  tier, and the retro scan's thresholds (14 days and 100 sessions) were decided
  without data. Re-check them after about two weeks of ledger.

## Consequences

- The harness holds only roles the loop launches, and the glossary, the guard
  role lists and the boundary evals shrink with them.
- A person who wants status or to file a request asks their own main session.
- Non-harness ideas have one gate, the `ready-for-agent` label, until a later
  decision adds another.
- The ticket work lands as separate pull requests: this record and the
  glossary first, then the removals, then the `spawn-session` deletion, then
  retro filing under its own ADR.
