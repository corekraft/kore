---
status: accepted
summary: Refines ADR 0117 and plan 12 Step 3: each harness idea names a primary metric only it moves, read from events the changed code does not write; metrics several ideas move are guard metrics that must not worsen; two ideas with one primary open their windows in sequence; no outcome is read until idea attribution holds among role sessions.
date: 2026-11-16
last-verified: 2026-11-16
---

# ADR 0119: Each harness idea is measured on a primary metric only it moves

Source: [`infra/plans/12-self-improving-loop.md` § Step 3](../../infra/plans/12-self-improving-loop.md#step-3-auto-approve-and-auto-revert)

Refines: [ADR 0117](0117-the-delivery-loop-s-role-set.md) (the qualifier) and plan 12 Step 3 (auto-revert).

## Context

Plan 12 Step 3 reverts a harness idea automatically when its outcome refutes
it, and ADR 0117's qualifier only checks that an idea's metric is in the flow
report with a trailing average. Ideas 0007 to 0016 showed what that leaves
open:

- Three ideas named `metrics.tokensPerIdea` (0007, 0014, 0015), two named
  `friction.total` (0011, 0013) and two `rework.sendBacksPerIdea` (0010,
  0016). With two of them on in one window, nobody can say which moved the
  metric, and an auto-revert can revert the wrong one.
- Some proposed metrics reach their target by construction. A count of failed
  `session notify` calls falls to 0 once briefs stop calling notify, and a
  count of questions the advisor's router sends to the owner is whatever the
  router decides.
- Only 461 of 64,688 ledger events carried an idea and a stage, so any metric
  divided per idea was read on noise.

## Decision

- **One primary metric per idea, that only it moves.** Each harness idea names
  a primary metric as its hypothesis metric. No other idea open in the same
  window names it.
- **The primary is independent of the change.** A reader can test it: the
  events behind the primary metric are written by a hook, a tool or a session
  other than the code the idea changes.
- **A guard idea is the one exception.** An idea that changes what a guard
  blocks may use that guard's block count as its primary, because fewer false
  blocks is the claim itself. Its outcome is confirmed only when the guard
  corpus still blocks every known-bad case in CI, and a replay of the window's
  transcripts lists the commands the old rule refused and the new one allows,
  which a reader pane checks and the judge reads (an empty list is stated as
  empty). One newly allowed command that left the worktree or wrote outside
  its role refutes the idea, whatever the count says. The revert restores what
  the owner had approved, so it needs no approval, but it and the escaping
  command go in the next owner digest, and the escape joins the guard corpus
  in the reverting change. The ledger never gains command text for this.
- **Shared metrics are guard metrics.** A metric that several ideas move is a
  guard metric each of them must not worsen, never the claim of any one. As of
  this record they are tokens, send-backs, friction, owner minutes and lead
  time.
- **Guard metrics and primaries are read per merged change.** A metric divided
  by completed ideas is too sparse to read in a window: an idea closes on its
  outcome, and 4 outcomes were recorded in four days against 319 merged pull
  requests. `metrics.tokensPerIdea`, `rework.sendBacksPerIdea`, the tokens by
  stage breakdown and `leadTime.medianSeconds` (first event to issue closed)
  each gain a per-merged-change form with a trailing average over windows, and
  that form is the one read; lead time's is the time from a pull request
  opening to its merge. `friction.total` and
  `outcomes.ownerMinutes.perMerged` already are. The per-idea forms stay for
  the qualifier and the retro trigger. A per-merge figure measures delivering
  a change, not an idea reaching its outcome, and is named so. A window with
  fewer merged changes than a minimum is reported as insufficient, not read.
- **Ideas with one primary go in sequence.** Two ideas that name the same
  primary open their windows one after the other: by flag for a flagged idea,
  by merge for a `no-behaviour-change` one. Ideas with different primaries run
  in the same window.
- **No outcome before attribution holds.** No harness idea's outcome is read
  until, among new events from sessions with a role, the share with an idea and
  a stage (`attribution.withIdeaAndStage`) has stayed above a target for 3
  consecutive days. Sessions with no role, such as the person's main session,
  drive many ideas at once and no stamp reaches them, so they are left out of
  this figure and their share of events is reported beside it. The target is
  set from a baseline cut by role before idea 0012 merges. Idea 0012, which
  makes the condition true, is the exception.
- **The qualifier check is its own idea.** Making the qualifier test an idea's
  primary against the guard metrics and against other open ideas is filed as a
  separate harness idea. It starts by warning and recording a ledger event;
  moving it to refuse changes the gate in front of auto-approval and goes to the
  owner, in the spirit of [ADR 0080](0080-guardrails-change-freely-activate-with-approval.md).

## How this was decided

By recommendation in a grilling session on ideas 0007 to 0016 on 2026-11-16,
answered on the owner's behalf by another session, not from data. The owner
may overrule it. The attribution target, the 3 days and the minimum merged changes per window are placeholders, re-checked
with ADR 0117's other placeholders after about two weeks of ledger.

## Consequences

- An idea whose natural metric is shared needs a narrower one first, such as
  tokens per idea by stage, a send-back reason category or a count from a hook,
  and that metric has to be in the flow report before the idea is qualified.
- A refuted outcome reverts the idea that moved its own metric, and a worsened
  guard metric shows which window to look at without blaming one idea.
- Sequencing costs time only where two ideas really share a primary; it is not
  a reason to hold back an idea whose primary differs.
