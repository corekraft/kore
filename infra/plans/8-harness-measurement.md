---
status: active
summary: Scaffold the tools/harness package and measure the delivery loop (stage events, toil, flow and bottleneck) to record a baseline before the harness changes.
last-verified: 2026-11-11
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
- [ ] Report per stage: active time, waiting time, toil (start, stop, wait,
      retry), work in progress, and lead time. (Toil landed in #160;
      tick when #160 and #161 both land.)
- [x] Name the bottleneck: the stage with the largest share of waiting,
      people included.

### Exit Criteria

- `node skills/bin/harness.mjs flow report --json` names a bottleneck from
  real ledger data.

## Step 5: Baseline

### Work

- [ ] Run the current workflow for at least five pieces of work with the
      ledger on.
- [ ] Record the baseline flow report under Results.

### Exit Criteria

- Plans 10 to 12 can each compare their effect against this baseline.

## Results

Not started.
