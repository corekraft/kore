# Kore

Kore is a platform repository and the agent-driven delivery loop that builds
it. This glossary names the concepts both share.

## Delivery loop

**ADR**:
An architecture decision record in `docs/decisions`: one numbered Markdown file
holding a decision, the context behind it and its consequences, listed in
`docs/index.md`.
_Avoid_: Design doc, decision log

**Idea**:
A proposed change, stated with the outcome it is expected to produce. The
start of the delivery loop.
_Avoid_: Feature request, task

**Outcome**:
The observed result that closes an idea: an experiment result, a usage result,
or a verification result. A merge is not an outcome.
_Avoid_: Done, shipped

**Autopilot**:
The delivery loop running from idea to outcome without a person driving each
step. It applies to how Kore is built, not to what Kore does for its users.
_Avoid_: Auto-merge, CI/CD

**Safe delivery**:
A change that can land on trunk without exposing users to unproven behaviour.
_Avoid_: Safe to deploy

**Safety pattern**:
The declared reason a change is safe to land on trunk: no behaviour change,
feature flagged, dark launched, branch by abstraction, or expand and contract.
_Avoid_: Merge strategy

**Friction**:
Anything that makes Kore fail to just work for its user; treated as a breaking
point.
_Avoid_: Papercut, nice-to-have

## Agent roles

**Concierge**:
The agent a person talks to. It answers status and turns requests into ideas,
and never reads code or writes files.
_Avoid_: Assistant, front-end agent

**Refiner**:
The agent that interviews a person about something they want to do and turns
it into an idea with a hypothesis and a measurable expected outcome.
_Avoid_: Analyst, product owner

**Challenger**:
The agent that attacks an idea, ADR or plan for weak hypotheses, unmeasurable
outcomes, wrong safety patterns and conflicts with recorded decisions, before a
person approves it. It never reviews code.
_Avoid_: Critic, reviewer

**Orchestrator**:
The agent that breaks an idea into work and drives it to an outcome, without
being interrupted.
_Avoid_: Planner, manager, lead

**Reader**:
An agent that only reads and summarizes for another agent.
_Avoid_: Explorer, researcher

**Writer**:
An agent that changes files for one piece of work.
_Avoid_: Implementer, coder

**Judge**:
An agent that decides whether a change is a safe delivery under its declared
safety pattern, and sends it back to the orchestrator when it is not.
_Avoid_: Reviewer, approver

**Tool**:
A deterministic script an agent calls in place of doing the steps itself.
_Avoid_: Helper, utility

## Self-improvement

**Harness**:
The agents, skills, tools, hooks and rules that run the delivery loop, as
opposed to Kore itself.
_Avoid_: Tooling, scaffolding

**Guardrail**:
A harness rule that blocks or gates an unsafe action. Changing one may be
automatic, but turning a changed one on needs a person's approval.
_Avoid_: Check, policy

**Toil**:
Time an agent spends not advancing work: waiting, starting up, stopping,
retrying.
_Avoid_: Overhead, idle time

**Bottleneck**:
The stage of the delivery loop with the largest share of waiting time, waiting
on a person included, and so the one that limits how fast ideas reach
outcomes.
_Avoid_: Slow step

**Stage event**:
A timestamped fact about one idea's journey through the delivery loop, such as
a session starting, a pane going idle, or a pull request merging. It records
that something happened, never what was said or changed.
_Avoid_: Log line, telemetry, trace

**Ledger**:
The append-only record of every stage event, shared by all work in progress on
a machine. It is written only through its tool and never edited by hand.
_Avoid_: Log, journal, history

**Flow**:
How ideas move through the delivery loop's stages, from refine to outcome,
measured from the ledger as active time, waiting time, toil and event count
per stage.
The flow report maps stage events to stages and names the bottleneck. It can
be limited to a time range and to named ideas, and states which in its scope.
_Avoid_: Pipeline, throughput

**Unmapped event**:
A stage event the flow report cannot place in a stage or attribute to an idea,
such as a label that is not the approval label or a pane with no role. It is
counted but left out of every stage.

**Completed idea**:
An idea whose issue has closed, which is its outcome. The flow report names a
bottleneck only once enough ideas have completed.
