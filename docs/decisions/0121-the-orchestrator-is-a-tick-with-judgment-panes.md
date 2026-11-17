---
status: proposed
summary: Proposed, refines ADR 0117: orchestrate tick advances each in-flight idea by at most one step per pass, calls no model itself, and spawns a short-lived Sonnet judgment pane under a small brief for the steps a tool cannot decide, against ADR 0117's sentence that no agent fills the Orchestrator role.
date: 2026-11-16
last-verified: 2026-11-16
---

# ADR 0121: The Orchestrator is a tick with judgment panes

Source: [idea 0007](../ideas/0007-orchestrator-tick.md) (#794) and [`infra/plans/11-agent-delivery-loop.md` § Step 6](../../infra/plans/11-agent-delivery-loop.md#step-6-orchestrator-and-concierge)

Refines: [ADR 0117](0117-the-delivery-loop-s-role-set.md).

## Status

Proposed. ADR 0117 says `orchestrate run` drives an idea and no agent does; a
Sonnet judgment pane partly reverses that. Its open questions were answered by delegation on 2026-11-16 (the owner, relayed by the answering session: "you can anaswer owner's questions"); the owner may overrule any of them (below). Those answers reach this record through a tagged agent message,
which is not approval (ADR 0120), so it becomes accepted on the owner's own
untagged comment on #794.

## Context

The hand-driven orchestrating session ran 7,236 turns at a median context of
255k tokens, with about 1,850 of 4,415 shell calls spent polling, and 91 of the
owner's 245 messages were watchdog work. Most of its steps are mechanical; a
few are not: splitting an idea into pieces of work, writing a brief, choosing
what runs in parallel, and handling a blocked pane.

## Decision

- **The tick.** `orchestrate tick` is one idempotent pass over the queue and
  the ledger that advances each in-flight idea by at most one step and exits.
  It calls no model. `orchestrate run <idea>` becomes a loop of ticks scoped to
  one idea; both call one step function per stage, so the step logic has one
  owner.
- **Judgment panes.** For a step a tool cannot decide, the tick spawns a fresh
  Sonnet pane with a small brief, under 60k tokens of context. Its definition
  is read-only, like the reader's. It ends with a plan, and the tick, not the
  pane, starts the Haiku panes the plan names.
- **The plan's form.** One JSON object between a `PLAN-JSON` line and an
  `END-PLAN-JSON` line, with exactly one of `reads`, `work` or `stop`:
  - `reads`: an array of objects with `question` and `paths`, each answered by
    a Haiku reader pane the tick starts; a fresh judgment pane then gets their
    summaries in its brief. The passes per decision are bounded.
  - `work`: an array of objects with `role` (writer or reader), `name`,
    `brief`, `files` (paths inside the repository) and `after` (names of
    pieces it waits for).
  - `stop`: a `reason`, for an idea that should go to the owner.

  The tick treats the plan as untrusted model text, as ADR 0118 does: it
  checks the whole plan (known roles, brief length, paths inside the
  repository, `after` naming pieces in the plan), and one bad item refuses
  the whole plan with the item and field named. A refused plan gets one
  retry, then the idea is labelled `needs-info`. The tick puts pieces that
  share files in sequence, whatever `after` says.

- **What a judgment pane never does.** It never spawns a pane, edits a file,
  merges, labels or approves an idea, records an outcome, turns a flag on, or
  answers a reserved decision.
- **Bounds.** One tick per machine under a lease recovered by age; a spawn is
  keyed on idea, stage and pull request head. The tick reads power and load
  itself: the whole unblocked frontier on AC power, saver mode on battery, no
  new starts above the configured load. Pieces of work that share a file run
  in sequence and local live runs one at a time. After the second send-back the
  writer escalates as today; after a third, one judgment pane decides to split,
  re-brief or stop, and only a stop or a failed retry labels the idea
  `needs-info` for the owner.
- **Running it.** `orchestrate tick --loop` runs in a pane the person starts,
  as a thin supervisor that runs each tick as a child process. `tick.started`
  and `tick.stopped` events give a heartbeat; a gap shows in status and in the
  owner digest. Only an opt-in installer the owner runs restarts it (below).
- **Comments carry the role.** The tick and its panes post only through the
  comment module, whose first line names the role, so their comments are
  never read as the owner's (ADR 0120). They hold the owner's token until the
  owner decides on separate identities, and ADR 0120 records that gap.
- **A flag guards it.** The change is behind `orchestrator-tick` (off). Its
  activation proof is one approved harness `no-behaviour-change` idea, named
  on #197 before the run, driven from approval to a recorded outcome with no
  person's step, with the flag on for that run only.

## Answered by delegation

- **The judgment pane: yes.** The owner's direction of 2026-11-16 (Sonnet is
  the main orchestrator, Haiku panes read and write, Opus advises; _note, 2026-11-16: the advisor later moved to Sonnet at high effort, per ADR 0120_) means a
  Sonnet judgment pane under the tick, where Sonnet decides and the tick
  spawns. The evidence against one long-lived orchestrating session is its own
  record, and idea 0007 as filed calls a model only for a judgment with a
  small fresh context.
- **Identity.** The tick and its judgment panes get their own GitHub identity,
  set up by the owner with the identities wizard, before the flag turns on
  (ADR 0120).
- **Restarting the loop.** A restart is built as an opt-in installer behind
  the `orchestrator-tick` flag. No agent installs it; the owner installs the
  standing job with their own command, informed by the heartbeat gaps the
  ledger counts.

## How this was decided

By recommendation in a grilling session on ideas 0007 to 0016 on 2026-11-16,
answered on the owner's behalf by another session. The 60k limit, the load
threshold, the lease age, the brief length and the read passes per decision
are placeholders.
