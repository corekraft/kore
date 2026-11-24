---
status: accepted
summary: Refines ADR 0121: a stalled step goes from the factory orchestrator role to the advisor with a fixed handoff, in place of a judgment pane; the tick stays deterministic and automatic approval stays.
date: 2026-11-23
last-verified: 2026-11-23
---

# ADR 0182: The orchestrator asks the advisor when no rule picks the next step

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 6](../../infra/plans/11-agent-delivery-loop.md#step-6-orchestrator-and-concierge)

Refines: [ADR 0121](0121-the-orchestrator-is-a-tick-with-judgment-panes.md)

## Context

ADR 0121 gives each step a tool cannot decide to a fresh Sonnet judgment pane
that ends with a plan. The factory role set graduated from the herdr lab
(`.claude/factory/`) splits that work: the orchestrator routes, and the advisor
(ADR 0120) decides. In the lab, an orchestrator that guessed a recovery route,
relaunched an exhausted writer or treated a recommendation as dispatch
permission was the recurring failure; a fixed handoff to the advisor removed it.

## Decision

- **The tick stays.** `orchestrate tick` keeps every defined handoff and still
  calls no model for a step a rule decides.
- **A stalled step goes to the advisor.** Where ADR 0121 spawns a judgment
  pane, the tick spawns the factory `orchestrator` role. It sends the advisor
  one handoff: the ticket's acceptance criteria, the stop reason as reported,
  the branch and diff from the writer's handoff, and what is edited, verified,
  and still outstanding, ending "What is the next best step?". It proposes no
  route itself.
- **The advisor's answer is direction, not permission.** The orchestrator
  routes the remaining scope, the advisor's record and the original handoff to
  the role the advisor names. It never labels a ticket, launches or relaunches
  a writer, resets a budget, merges or clears a release.
- **Approval stays automatic.** `ready-for-agent` is applied by the owner or
  by `harness approve`, as today; only that label authorizes dispatch, and only
  the tick dispatches.
- **A flag guards it.** Behind `factory-orchestrator` (off). Until it is on,
  ADR 0121's judgment panes run unchanged.

## Consequences

- The `judgment` role is retired once the flag is proven and on; its plan
  checks move to the handoff the orchestrator sends.
- The `orchestrator` role needs a guard group before it can be spawned: it may
  run `session spawn` for the advisor and read, and nothing that writes.
- Lab cases: `.claude/factory/orchestrator/expectations.md`.

## How this was decided

By the owner in the factory adoption session of 2026-11-23, after the herdr lab
passed every case for the factory roles in three consecutive runs.
