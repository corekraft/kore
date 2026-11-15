---
status: active
summary: Split tests into unit, integration and live tiers, rewrite every unit test to one unit with everything mocked, and enforce a speed budget; feature work was paused until it was done, and that pause lifts when Step 4 merges.
last-verified: 2026-11-14
---

# Test Tiers Plan

## Purpose

Unit runs took 1m26s in `tools/kore` and 1m05s in `tools/harness` on the
owner's host (2026-11-12, two workers). A few files that run real `git`, `sh`
and `bash`, or wait on real timers, took most of that time. Slow tests are
toil for people and agents, so the owner paused all feature work until the
tests are fast.

The decision is
[ADR 0098](../../docs/decisions/0098-unit-tests-mock-everything-outside-the-unit-and-integration-tests-gate-only-a-release.md);
the terms are in [`GLOSSARY.md`](../../GLOSSARY.md) (Testing). Tracking issue:
#371.

## Step 1: Foundations

Next: Waiting only on the owner or a run, each stated on its issue and rolled up on #371: #372 (nightly dispatched by the owner on 2026-11-14; run [43683521139](https://github.com/corekraft/kore/actions/runs/43683521139) must be green and recorded; the first run was red on test:live:footprint), #419 (built in #464; needs a red integration run to prove the open and update paths). #373 is ticked: integration is a required check on main (#595 and the ruleset sync) and green main run [43652291997](https://github.com/corekraft/kore/actions/runs/43652291997) is recorded. Unit-run budget is 2 min (ADR 0106). No agent work is owed.

### Work

- [ ] Rename the cluster suites to live tests (#372). #439 delivered the
      rename; a green nightly run is still owed.
- [x] Add the integration tier with one hook test moved into it (#418).
- [x] Move the remaining script, hook and bundle tests to integration, and
      make the commit gate unit-only (#373).
- [ ] A failing integration run opens one issue (#419). Open.
- [x] Fail the unit run on the test budget, with per-domain unconverted lists
      (#374).
- [x] Report a missing or extra spec per unit, and reset mocks by
      configuration (#420).
- [x] Barrel rule for the kore package (#421), then the harness package
      (#422).

### Exit Criteria

- A unit run starts no process.
- The budget fails the run for a converted source file, and the unconverted
  lists hold every existing source file.

## Step 2: Pilots

### Work

- [x] Pilot: convert the kore `security` domain (#385).
- [x] Pilot: convert the harness `guardrail` domain (#393).

### Exit Criteria

- The contributor guide shows the mocking patterns the pilots settled.

## Step 3: Convert Everything Else

One pull request per ticket, in parallel, as many as the test lock admits.
Label them all `ready-for-agent` when the pilots merge. Large domains are
split into batches of about 15 source files.

### Work

- [x] Convert the rest of the kore package: 16 tickets (#375 to #384 except
      the pilot, and #423 to #428).
- [x] Convert the rest of the harness package: 20 tickets (#386 to #401 except
      the pilot and the closed #391, and #429 to #434).

### Exit Criteria

- Every unconverted list is empty and deleted: done (PRs #570, #571 and #574).
- Each package's full unit run takes under 2 min (ADR 0106): tools/kore
  measured 18.8 s in CI. Its unit coverage meets its thresholds.

## Step 4: Gate the Release and Lift the Pause

### Work

- [x] Run integration tests after every merge and gate the release tag on
      them (#404). Merged in #572 (ADR 0105); the proof is recorded on #404
      (closed 2026-11-14 on real main release runs, not a dispatch).
- [x] Measure and raise the unit test worker cap (#405). Measurements are
      recorded on #405; the default of two shipped in #598, and the live
      responsiveness run is waived by the owner on 2026-11-14 as debt #659.
- [x] Remove the `paused` label from the frozen issues and pull requests, and
      the pause from the `Next:` lines of plans 2, 11, 12 and 13. The `Next:`
      lines are done in this PR; the label removal is done by the orchestrator
      right after this PR merges.

### Exit Criteria

- A failing integration test on main leaves no new release tag: #572 merged;
  the proof is recorded on #404.
- No issue or pull request carries `paused`: done by the orchestrator right
  after this PR merges.

## Results
