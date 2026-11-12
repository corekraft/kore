---
status: done
summary: Scaffold the tools/harness package and measure the delivery loop (stage events, toil, flow and bottleneck) to record a baseline before the harness changes.
last-verified: 2026-11-12
---

# Harness Package and Delivery Measurement Plan

## Purpose

Plans 10 to 12 change how Kore is built: tools in place of hand-run steps,
agent roles in Herdr panes, and a loop that improves itself. None of them can
show it helped without a baseline from today's way of working. This plan
builds the harness package
([ADR 0082](../../docs/decisions/0082-harness-package-bundled-for-skills.md))
and uses it first to measure the delivery loop. Terms follow
[`GLOSSARY.md`](../../GLOSSARY.md).

## Principles

- **Measure, don't self-report.** Events come from hooks, Herdr pane
  lifecycle, Claude session transcripts and GitHub, never from an agent
  describing itself.
- **Timestamp everything.** Every event carries its source, session, pane and
  time.
- **Append-only.** The ledger is written only through its tool.

## Step 1: Scaffold the Harness Package

### Work

- [x] Create `tools/harness` with the `tools/kore` toolchain: strict
      TypeScript, oxlint `--deny-warnings`, prettier, vitest, v8 coverage with
      a threshold, and an injectable runner.
- [x] Pin esbuild as a dev dependency and bundle to `skills/bin/harness.mjs`
      with no runtime dependencies. Commit the bundle.
- [x] Add `mise run` tasks for the harness test, lint, format and build.
- [x] Add a CI step that rebuilds the bundle and fails on any difference.
- [x] Wire the package into the commit hooks and the stop hook.

### Exit Criteria

- `node skills/bin/harness.mjs --help` runs from a fresh clone without
  `npm ci`.
- [x] CI fails when the bundle is stale.

## Step 2: Skill Budget Audit

### Work

- [x] Add a `skill` domain whose `audit` command reports every skill whose
      description exceeds 200 characters or whose body exceeds 25 lines.
- [x] Run it from kb-check in warn mode.

### Exit Criteria

- [x] `node skills/bin/harness.mjs skill audit --json` lists each skill with its
      description length, body length and verdict.

## Step 3: Stage Event Ledger

### Work

- [x] Add a `ledger` domain: an append-only JSONL ledger with a schema for
      stage events (source, session, pane, idea, stage, kind, time).
- [x] Record Claude session events (start, stop, tool start and end) from the
      existing hooks through the harness.
- [x] Record Herdr pane events (spawned, busy, waiting, closed).
- [x] Record GitHub events (issue opened, labelled, PR opened, merged) by
      polling with `gh`.
- [x] Guard the ledger as append-only.

### Exit Criteria

- [x] A spawned pane that runs one task leaves a start, a tool sequence, a
      wait, and a close in the ledger, each timestamped.

## Step 4: Flow Report and Bottleneck

### Work

- [x] Add a `flow` domain that maps events to the stages refine, challenge,
      await approval, orchestrate, write, judge, merge, verify and outcome.
- [x] Report per stage: active time, waiting time, toil (start, stop, wait,
      retry), work in progress, and lead time.
- [x] Name the bottleneck: the stage with the largest share of waiting,
      people included.
- [x] Limit the report to a time range and to named ideas, clipping intervals
      at the range edges, and state the scope covered.

### Exit Criteria

- [x] `node skills/bin/harness.mjs flow report --json` names a bottleneck from
      real ledger data (`await approval`; see Results).

## Step 5: Baseline

### Work

- [x] Run the current workflow for at least five pieces of work with the
      ledger on.
- [x] Record the baseline flow report under Results.

### Exit Criteria

- [x] Plans 10 to 12 can each compare their effect against this baseline
      (fields named under Results).

## Results

### Baseline (issue #163)

- **Period:** 2026-11-12, UTC (`--since 2026-11-12T00:00:00Z --until
2026-11-13T00:00:00Z`), measured as of 2026-11-12T11:59Z.
- **Ideas covered:** 47 completed, each a piece of work delivered by a writer
  pane and closed on GitHub: #130 to #145, #147, #150, #153, #156, #158 to
  #162, #164 to #175, #177, #178, #185 to #189, #201, #204, #230. Ledger on for
  all; `ledger poll-github` and `ledger poll-herdr` run against the shared
  ledger. The report covers exactly these ideas (`--idea`).
- **Command:** `node skills/bin/harness.mjs flow report --json --ledger
<shared .kore/state/ledger.jsonl> --since ... --until ... --idea <the 47>`.
- **Lead time** (first event to issue close): median 7139 s (about 2.0 h), max
  15397 s (about 4.3 h).

| Stage          | Active s | Waiting s | Events | WIP peak | WIP avg |
| -------------- | -------: | --------: | -----: | -------: | ------: |
| refine         |        0 |         0 |      0 |        0 |       0 |
| challenge      |        0 |         0 |      0 |        0 |       0 |
| await approval |        0 |    342087 |     48 |       46 |  3.9593 |
| orchestrate    |        0 |         0 |      0 |        0 |       0 |
| write          |        0 |         0 |      0 |        0 |       0 |
| judge          |        0 |         0 |      0 |        0 |       0 |
| merge          |        0 |     45047 |     92 |        8 |  0.5214 |
| verify         |        0 |         0 |      0 |        0 |       0 |
| outcome        |        0 |         0 |     47 |        0 |       0 |

Toil is 0 in every stage.

- **Bottleneck:** `await approval`, 342087 waiting seconds, 88.36% of all
  waiting. Every ticket was labelled `ready-for-agent` when it was published,
  so this is not a person's approval. It is tickets waiting for their blockers
  to merge and for the orchestrator to spawn a writer; the stage mapping does
  not tell those apart from approval.
- **Limits of this baseline:** only GitHub events attribute to an idea.
  Claude session and pane events carry no idea (the ledger records a pane id and
  session id, never the issue, and pane ids are reused), so refine, challenge,
  orchestrate, write, judge and verify show no active time. The "merge" stage
  is PR opened to PR merged, so it includes the orchestrator's review and fix
  rounds. The `await approval` reading cannot yet separate blocked from
  ready-and-unclaimed; the next step is to separate them. Plans 10 to 12
  compare only the stages that carry data; closing the pane-to-idea join is for
  a later step.
- **Joins added for this baseline** (design choice, flagged in the PR):
  `ledger poll-github` records `issue.closed` at GitHub's `closedAt`, and gives
  `pr.opened` and `pr.merged` the `idea` of the first issue the PR closes
  (`closingIssuesReferences`), so the merge stage attributes to its idea.

### Fields plans 10 to 12 compare against

All from `flow report --json` (version 4), same `--idea` or period scope:

- `ideas.completed` (47)
- `leadTime.medianSeconds` (7139) and `leadTime.maxSeconds` (15397)
- `stages[].waitingSeconds` and `stages[].activeSeconds`, per `stage`
- `stages[].wip.peak` and `stages[].wip.average`
- `stages[].toil.*Seconds`
- `bottleneck.stage` (`await approval`) and `bottleneck.share` (0.8836)
