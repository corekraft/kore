---
status: active
summary: Run delivery on autopilot from idea to outcome with role agents in Herdr panes, idea and outcome records, feature flags, a safety-pattern judge, and a protected main.
last-verified: 2026-11-12
---

# Agent Delivery Loop Plan

## Purpose

Software delivery should run on autopilot so Kore itself can just work for its
user. The loop runs from an idea to an outcome, not to a merge. Merging is
trivial because trunk-based development makes every change declare why it is
safe. Terms follow [`GLOSSARY.md`](../../GLOSSARY.md). Each step reports its
effect against the plan 8 baseline.

## Current Limits

Merges are by the owner's hand until the judge identity exists. The judge and
merge tool are built, but they run under the owner's GitHub identity, so they
do not yet bound anything
([ADR 0091](../../docs/decisions/0091-containment-comes-from-identities-and-a-sandbox-not-role-guards.md)).

## Principles

- **One human gate.** A person approves an idea; everything after is
  autonomous.
- **Every change declares a safety pattern.**
- **The queue is the only channel** between the concierge and the
  orchestrator.

## Step 1: Idea and Outcome Records

### Work

- [x] Add `idea` and `outcome` domains: create `docs/ideas/NNNN-slug.md`, list
      it in `docs/index.md`, and sync it one way to a GitHub issue
      ([ADR 0079](../../docs/decisions/0079-idea-and-outcome-records.md)).
- [x] Record an outcome from its source (live run, journal, eval history,
      experiment comparison) into the markdown and post it to the issue with
      its `outcome:*` label.
- [x] Teach kb-check the idea frontmatter.

### Exit Criteria

- An idea cannot close without an outcome, and a refuted one opens a new idea.

## Step 2: Role Agent Definitions

### Work

- [x] Add agent definitions for concierge, orchestrator, reader, writer and
      judge, each with its default tier in frontmatter
      ([ADR 0078](../../docs/decisions/0078-agent-roles-run-as-herdr-panes.md)).
- [x] Add guard cases for every capability a role gains, before it gains it.

### Exit Criteria

- `claude --agent <role>` launches each role with its tier, and the eval suite
  covers each role's boundary.

## Step 3: Refiner and Challenger

### Work

- [x] Add the Refiner (Sonnet, medium) and Challenger (Opus) agent
      definitions.
- [x] The concierge hands raw requests to the Refiner via the person until
      Step 6. The Challenger reviews each refined idea, at most two rounds,
      then the idea goes to a person with any open objections listed.
- [x] The Challenger also reviews new ADRs and plans.
- Known limit: rounds count per `gh` account (the one running `idea challenge`),
  so a different account gets two more; closing that needs a second credential
  no role has.

### Exit Criteria

- A raw request becomes an approved-ready idea with a hypothesis, a measurable
  expected outcome and a likely safety pattern.

## Step 4: Feature Flags and Activation Proof

### Work

- [x] Add a schema-validated `features:` map to environment overlays, off by
      default, read by `kore` and chart values
      ([ADR 0077](../../docs/decisions/0077-live-proof-gates-activation-not-merge.md)).
- [x] Require recorded live proof before a flag turns on in an environment.
- [x] Rewrite the "It just works" rule in AGENTS.md: live proof gates
      activation, except for cluster-facing `no-behaviour-change` changes.

### Exit Criteria

- A flag cannot turn on in an environment without live proof on record.

## Step 5: Judge and Merge

### Work

- [x] Add a `judge` domain whose precheck reports CI, scan, coverage and
      principles-review results, plus hints for the declared safety pattern.
- [x] The judge agent verifies the diff matches the declared pattern and
      merges through the merge tool, or sends the change back to the
      orchestrator with the reason.
- [x] Add a `main` ruleset requiring `check` and `scan`, after asking the
      operator.

### Exit Criteria

- A PR without a declared pattern, or with one its diff does not match, never
  merges.

## Step 6: Orchestrator and Concierge

### Work

- [ ] The orchestrator runs in its own Herdr pane, reads the queue only
      between pieces of work, and launches readers, writers and judges as
      panes.
- [ ] Writers escalate from Haiku to Sonnet after two judge send-backs, by
      relaunching with different parameters.
- [ ] The concierge answers status from plans, issues and the ledger, and
      files requests as ideas.

### Exit Criteria

- An approved idea reaches an outcome with no person driving a step.

## Step 7: First Workload

### Work

- [ ] Run plan 7 (cohesive domain classes) through the loop as its first real
      workload.

### Exit Criteria

- The plan 7 conversions merge through the judge, and the flow report shows
  where the loop waited.

## Results

Not started.
