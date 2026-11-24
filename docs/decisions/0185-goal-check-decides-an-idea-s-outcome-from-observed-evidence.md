---
status: accepted
summary: Refines ADR 0079: goal check compares the idea's stated goal with evidence observed in the intended environment, never a merge, a closed ticket or a flag flip, and an inconclusive result ends pursuit.
date: 2026-11-23
last-verified: 2026-11-23
---

# ADR 0185: Goal check decides an idea's outcome from observed evidence

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 1](../../infra/plans/11-agent-delivery-loop.md#step-1-idea-and-outcome-records)

Refines: [ADR 0079](0079-idea-and-outcome-records.md)

## Context

ADR 0079 records an idea's outcome, and ADR 0097 closes an outcome issue on
recorded proof rather than on merge. `harness evaluate` judges a harness idea
by its metric; an idea whose goal is a behaviour or an activation has no
judge for whether its goal was met.

## Decision

- **Goal check compares the stated goal with observed evidence** from the
  intended environment, citing each criterion and the observation that does or
  does not meet it.
- **Activation and outcome are distinct.** When activation is the goal, goal
  check confirms the activation; otherwise it verifies the outcome itself. A
  merge, closed tickets or a flag flip never substitute.
- **Its result is the recorded outcome.** It is written through `outcome
  record` as confirmed, refuted or inconclusive, and scoped to the environment
  it observed.
- **Inconclusive ends pursuit.** When the evaluation window ends and the result
  cannot be established, the idea is recorded inconclusive and no further work
  cycle starts.
- `harness evaluate` keeps judging harness ideas by their metric.

## Consequences

- Goal check is read-only: it never changes the criterion, launches work or
  activates anything.
- Lab cases: `.claude/factory/goal-check/expectations.md`.

## How this was decided

By the owner in the factory adoption session of 2026-11-23, after the herdr lab
passed every case for the factory roles in three consecutive runs.
