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

**Orchestrator**:
The role that drives an approved idea to an outcome, filled by a tool rather
than an agent.
_Avoid_: Planner, manager, lead

**Reader**:
An agent that only reads and summarizes for another agent.
_Avoid_: Explorer, researcher

**Writer**:
An agent that changes files for one piece of work.
_Avoid_: Implementer, coder

**Judge**:
An agent that decides whether a change is a safe delivery under its declared
safety pattern, merges it through the merge tool, and, when it is not, sends it
back to its writer through the orchestrator with the reason.
_Avoid_: Approver, Reviewer (a separate role)

**Reviewer**:
The role that checks a change against the judgement rules in `AGENTS.md`. A
tool posts its verdict, and the judge reads it.
_Avoid_: Judge, critic

**Precheck**:
The deterministic evidence a change is checked against before any judgement. A
failing precheck sends the change back by itself.
_Avoid_: Lint, gate

**Tool**:
A deterministic script that does a step in place of an agent, and may launch
agents.
_Avoid_: Helper, utility

## Self-improvement

**Harness**:
The agents, skills, tools, hooks and rules that run the delivery loop, as
opposed to Kore itself.
_Avoid_: Tooling, scaffolding

**Guardrail**:
A harness rule that blocks or gates an unsafe action. Changing one may be
automatic, but turning a changed one on needs a person's approval. The
guardrail inventory (`.claude/guardrails.yaml`) lists each guard rule with its
kind, mode (`audit` warns and records a ledger event; `enforce` blocks) and
owner. A deny rule is a guardrail too: its permission patterns are generated
into the settings deny list when it enforces, and the guard warns on a match
when it audits, since a settings deny cannot warn. The `main` ruleset is a
guardrail too, one inventory entry per rule (`main-ruleset-<rule>`): `main`
stays active, an audit rule syncs into the `main-candidate` ruleset in GitHub's
`evaluate` enforcement, and promoting it moves it into `main`
(`harness ruleset sync`, ADR 0090). `harness ruleset insights` summarizes what
the candidate would have blocked.
_Avoid_: Check, policy

**Proposal**:
A retro finding in a fixed form that a tool files as an idea. It is not an idea
until filed.
_Avoid_: Suggestion, recommendation

**Tier**:
The model and effort a role runs at. Its definition declares it, and only an
escalation or a recorded override changes it.
_Avoid_: Level, size

**Primary metric**:
The one flow-report metric a harness idea claims to move, which no other idea
open in the same window claims, read from events the changed code does not
write.
_Avoid_: Hypothesis metric (the frontmatter field that holds it), KPI

**Guard metric**:
A flow-report metric several ideas move, which each of them must not worsen
and none of them claims.
_Avoid_: Guardrail (a rule that blocks), shared metric, counter-metric

**Toil**:
Time a person or an agent spends not advancing work: waiting, starting up,
stopping, retrying.
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
How ideas move through the delivery loop's stages, from idea to outcome,
measured from the ledger as active time, waiting time, toil and event count
per stage.
The flow report maps stage events to stages and names the bottleneck. It can
be limited to a time range and to named ideas, and states which in its scope.
_Avoid_: Pipeline, throughput

**Unmapped event**:
A stage event the flow report cannot place in a stage or attribute to an idea,
such as a label that is not the approval label or a pane with no role. It is
counted but left out of every stage.

**Merged change**:
One pull request merged to `main`, the unit a per-merge metric counts. It
measures delivering a change, never an idea reaching its outcome.
_Avoid_: Shipped, delivered idea

**Completed idea**:
An idea whose issue has closed, which is its outcome. The flow report names a
bottleneck only once enough ideas have completed.

## Testing

**Unit**:
One class, or one function treated as a class with a single method. It is the
thing a unit test exercises.
_Avoid_: Module, component

**Unit test**:
A test of one unit alone. Everything the unit depends on that has behaviour is
replaced with a mock, including pure helpers and other units in its own
domain. Only types, error classes and constants are real. Unit tests gate
every commit.
_Avoid_: Fast test, spec

**Integration test**:
A test that real units from built domains work together. It may run local
processes and use files, but never a cluster or the network. It may replace a
domain's own cluster-facing modules with scripted replies. Integration tests
never gate a commit. They gate a merge only for a change to the commit
hooks, and a failing one stops a release.
_Avoid_: Script test, wiring test, bundle test

**Live test**:
A test that creates, changes or destroys a cluster. It runs only when asked.
_Avoid_: Integration test, live spec, e2e test

**Domain**:
A group of units with one area of responsibility. Units in other domains
reach it only through its public surface.
_Avoid_: Package, layer

**Distroless runtime image**:
The image an application runs in, holding no shell and no package manager. Images may be built in any stage, but only a distroless one runs.
_Avoid_: Slim image, minimal image
