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

**Main session**:
The session the owner attends, which starts role panes and talks to them. It
has no agent definition, holds the owner's token and is never spawned.
_Avoid_: Orchestrator session, orchestrating session, driver

**Pane result**:
What a finished pane leaves its caller: an outcome word, done or blocked, and
a short summary.
_Avoid_: Finish line, notification

**Reader**:
An agent that only reads and summarizes for another agent.
_Avoid_: Explorer, researcher

**Writer**:
An agent that changes files for one piece of work.
_Avoid_: Implementer, coder

**Follow-up**:
A message sent to a writer session after its brief, by the main session or a
tool, always carrying a sender line.
_Avoid_: Nudge, ping

**Branch update notice**:
The one signed follow-up the tick sends a writer when its PR conflicts with main
or is ready but for being behind: it tells the writer to merge origin/main and
never pushes the branch itself.
_Avoid_: Rebase request, branch update

**Judge**:
An agent that decides whether a change is a safe delivery under its declared
safety pattern, merges it through the merge tool, and, when it is not, sends it
back to its writer through the orchestrator with the reason.
_Avoid_: Approver, Reviewer (a separate role)

**Send-back category**:
The required reason class on a judge send-back, from a fixed list, set when the
send-back is recorded. A send-back with no category, or one outside the list, is
refused before anything is posted or recorded.
_Avoid_: Reason code, send-back type

**Legacy send-back**:
A judge send-back recorded before 2026-11-16, when the send-back command began
to require a category. The flow report counts it apart as `legacy`, never as
uncategorised or `other`, and leaves it out of the share of `other`; it is not
back-filled.
_Avoid_: Uncategorised send-back (that is one from after the requirement with no category)

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

## Cost

**Main-session cost**:
The priced model usage of the main session over a window, divided by the merged
changes that merged in that window. It is a window ratio and is never assigned
to a pull request.
_Avoid_: Orchestrator cost, per-PR cost

**Compaction cap**:
The context size, in tokens, past which the main session's history is
compacted.
_Avoid_: Context limit, compaction threshold

**Main-session setup**:
The label a stretch of main-session work gets from recorded facts when the flow
report reads: control (today's main-session model, largest prompt above the
compaction cap), early compaction (the same model, at or under the cap) or Haiku.
With no cap set a stretch with a reading reads "not set", whatever its model. It
is never written or typed.
_Avoid_: Experiment arm, variant

**Handover**:
A message from a cheap session to the stronger one that passes on a case and
names the reason for it. It is counted as a reading and never enforced.
_Avoid_: Escalation, transfer

**Weekly token ceiling**:
The limit, in plan-weighted tokens, on one week's token use. The owner sets its
value; it is not read from the plan.
_Avoid_: Token budget, plan limit

**Share of the weekly ceiling**:
A role's plan-weighted tokens in the trailing 7 days as a fraction of the weekly
token ceiling: a rate, read per agent. The flow report labels it "of the weekly
ceiling"; the rows of a level sum, and the sum may pass 100% because agents
overlap in time.
_Avoid_: Plan percentage, usage percentage

**Share of one week's ceiling**:
A merged change's or an idea's total plan-weighted tokens as a fraction of one
week's weekly token ceiling: a size, never a rate, printed with its span. The
flow report labels it "of one week's ceiling" and never puts it in a column with
a **Share of the weekly ceiling**. With no ceiling set it reads "not set", never
zero.
_Avoid_: Plan percentage, usage percentage

**Rework**:
A follow-up sent to a writer after a judge send-back of the pull request that
writer started. Any other follow-up is not rework.
Rework is a subset of **Follow-up**.
_Avoid_: Retry, resend

**Review round**:
One pass by the **Judge** or by a principles review over one head of a pull
request, clean or failed. The judge's pass and the reviewer's pass are separate
rounds by separate roles; a round names neither role's verdict.
_Avoid_: Review cycle, iteration

**Failed review round**:
A review round that found fault: a "Sent back by the judge" comment, or a
principles-review verdict with one or more violations. It differs from
**Rework**: a failure the writer fixes without a send is a failed review round
but not rework.
_Avoid_: Rejection, failed review

**Review coverage**:
The share of **Merged changes** with a principles-review verdict for their
head. A verdict on an older head does not count for a later one.
_Avoid_: Review rate, reviewed share

**Break-even**:
The **Rework** rounds per **Merged change** at which Haiku's median
**Merged-change cost** reaches Sonnet's. The cost of one round is read from
Haiku's own changes, and a tier with too few merged changes has none.
_Avoid_: Savings point, parity

**Send-back**:
The judge's return of a pull request to its writer, with the reason. The list
of categories a send-back can take lives in code, not here.
_Avoid_: Rejection, bounce

**Merged-change cost**:
The all-in dollars of one **Merged change**: its writer's, its reviewer's, and
its share of the judge's and the main session's spend. It is attributed to the
tier of the writer that started the change. The flow report's text prints, for the
merged changes, one summary line in the window (joined count, median and
p90 of all-in dollars and tokens, or "not read" with the joined count below the
minimum, or "insufficient prices" naming the models when one is not in the price table). Per-change rows, and their seconds from first
writer launch to merge, appear only in `--json` (`costWaiting.mergedChanges.changes`). Each
role's and each idea's figures are session totals and idea spend, not this term.
The headline names no winner.
_Avoid_: Cost per PR, per-PR cost

**Unattributed writer tokens**:
The tokens (and dollars) of writer sessions that no idea's figure holds: a session
whose linked pull request carries no idea (`none`, or none from the poll), or that
has no `pr.linked` event. The flow report's `costWaiting.writing` names them as the
`noIdea` and `noPullRequest` buckets beside the per-idea figures and never adds them
to an idea. Its share, the attributed tokens over all writer tokens in the window, is
a reported reading, not an idea's metric.
_Avoid_: Lost tokens, orphan tokens

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
escalation or a recorded override changes it. A launch's tier has one origin:
the definition, an escalation, or a recorded override.
_Avoid_: Level, size

**Window effort**:
The one effort, part of a Tier, at which both arms of the writer-tier window
launch. The owner sets it when opening the window.

**Randomized launch**:
A writer launch that the window's draw assigned to an arm: the drawn Sonnet or
the control Haiku. A writer launch chosen by hand is not randomized.

**Arm**:
One of the groups of writers a window compares, defined by the Tier of each
writer's first launch.

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

**Finish detection**:
The share of a flow report's pane results that a `pane.finished` on the same
pane noticed within the detection window, a placeholder of 300 seconds. A result
is noticed only when `session wait` recorded that finish: a pane read or a
message to the pane records nothing, so it counts as not noticed. The undetected
results split into never noticed (no `pane.finished` was ever recorded on the
pane) and late (one was recorded outside the window, or already used). Lag is how
late a finish was recorded, never a merge delay.
_Avoid_: Stop detection, finish rate

**Silent session**:
A session whose last `token.usage` is more than 900 seconds before the report's
measuring point, with no RESULT since, and with no background command or open
reserved question on its pane. The flow report counts silent sessions beside the
recorded `pane.stalled` count. It is a token-usage reading, not a stalled pane.
_Avoid_: Stalled pane, stall count

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

## Chart locks

**Main chart lock**:
A chart lock that may feed a local proof but never counts for flag activation.
_Avoid_: Dev lock, snapshot lock

**Release chart lock**:
The chart lock that counts for flag activation.
_Avoid_: Tag lock, final lock

## App model

**Service**:
The deployed unit of an application: one name, one suborg, one set of components, one app record. A repository may hold several.
_Avoid_: App (informal only), microservice, workload

**App repository**:
The repository an application's source lives in, outside the Kore repository. It holds source, a build file and the application's declarations, never manifests.
_Avoid_: App repo mirror, source mirror

**App record**:
The pair of files in the Kore repository that describe one service: the spec file, which people review, and the release file, which only the platform writes.
_Avoid_: Registration, service manifest

**Spec file**:
The half of an app record that says what a service is and may do: its suborg, repository, components, resources, grants, hostnames and gateway.
_Avoid_: Service definition

**Release file**:
The half of an app record that says what runs: the signed digest of each component and the on or off state of each flag. Only the platform writes it.
_Avoid_: Lock, deploy file

**Suborg**:
An organization one level below the tenant root. It is the namespace, quota and trust boundary of its services, the second label of their hostnames, and may be a short-lived sandbox that is torn down whole.
_Avoid_: Team, project, tenant

**Suborg namespace**:
The one namespace a suborg's services share, named exactly like the suborg and owned by the platform, never by Argo CD or a service.
_Avoid_: App namespace, service namespace

**Grant**:
An entry in a service's spec that lets another named service in another suborg reach it. Without one, traffic between suborgs is denied.
_Avoid_: Allow rule, exception
