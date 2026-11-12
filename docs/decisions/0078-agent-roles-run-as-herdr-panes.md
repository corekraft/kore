---
status: accepted
summary: Each delivery-loop role is an agent definition with its default model and effort in frontmatter, launched in its own Herdr pane as one parameterized claude command, in bypass mode bounded by guards.
date: 2026-11-11
last-verified: 2026-11-12
---

# ADR 0078: Agent roles run as Herdr panes from agent definitions

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 2](../../infra/plans/11-agent-delivery-loop.md#step-2-role-agent-definitions)

Refines: the model table in `skills/spawn-session/SKILL.md` and the Herdr
session pattern recorded in
[`infra/plans/6-agent-primitives.md` § Results](../../infra/plans/6-agent-primitives.md#results).

## Context

One long, interrupted session spends tokens rereading context and loses track
of work when a person breaks in. The orchestrator in particular behaves badly
when interrupted. Herdr panes make every running agent visible, and cheap
models suffice for most roles once deterministic steps are tools.

## Decision

The delivery loop has these roles, each an agent definition under
`.claude/agents/` whose frontmatter owns its default tier:

| Role         | Default tier   | Job                                                       |
| ------------ | -------------- | --------------------------------------------------------- |
| Concierge    | Haiku, low     | Talks to the person; answers status; files ideas.         |
| Refiner      | Sonnet, medium | Turns a raw request into an idea.                         |
| Challenger   | Opus, high     | Attacks ideas, ADRs and plans; never code.                |
| Orchestrator | Haiku, high    | Drives approved ideas to outcomes.                        |
| Reader       | Haiku, low     | Reads and summarizes.                                     |
| Writer       | Haiku          | Changes files for one piece of work, in its own worktree. |
| Judge        | Haiku, medium  | Decides whether a change is a safe delivery.              |

Every role runs in its own Herdr pane, launched as
`claude --agent <role> --model <model> --effort <effort>`. Escalation is the
same command with different parameters: a writer moves to Sonnet after two
judge send-backs. Writers have no concurrency limit.

The concierge and the orchestrator never message each other. They share the
queue: GitHub issues, labels and comments. The orchestrator reads the queue
only between pieces of work, so nothing interrupts it mid-task.

Panes run in bypass permission mode. Guard hooks and deny rules are the
boundary, and they apply to every pane.

## Consequences

Guard coverage becomes load-bearing: an action the guards do not block, an
autonomous pane can take. New guard cases are added before a role gains a new
capability. Token spend and machine load scale with work in flight, and the
ledger reports both.

## Refinement: the writer's effort is explicit

`session spawn` reads each role's model and effort from its agent definition
and refuses a role that declares no effort, so the orchestrator never picks a
tier. The table gives the writer only a model, which would make spawning a
writer fail. The table stays as accepted; this refinement sets the writer's
effort. A row here overrides the table's, and a test compares both with the
definitions.

- Writer: Haiku, medium.

Medium matches the judge. A writer that escalates after two judge send-backs
keeps this effort and changes only its model.
