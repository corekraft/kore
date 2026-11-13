---
status: active
summary: Split tests into unit, integration and live tiers, rewrite every unit test to one unit with everything mocked, and enforce a speed budget, with all feature work paused until it is done.
last-verified: 2026-11-12
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

Next: #372, #374 and #421 are labelled `ready-for-agent` and can run in parallel; #372 lands first. Label each later ticket when its blockers close. Full state: #371.

### Work

- [ ] Rename the cluster suites to live tests (#372).
- [ ] Add the integration tier with one hook test moved into it (#418).
- [ ] Move the remaining script, hook and bundle tests to integration, and
      make the commit gate unit-only (#373).
- [ ] A failing integration run opens one issue (#419).
- [ ] Fail the unit run on the test budget, with per-domain unconverted lists
      (#374).
- [ ] Report a missing or extra spec per unit, and reset mocks by
      configuration (#420).
- [ ] Barrel rule for the kore package (#421), then the harness package
      (#422).

### Exit Criteria

- A unit run starts no process.
- The budget fails the run for a converted source file, and the unconverted
  lists hold every existing source file.

## Step 2: Pilots

### Work

- [ ] Pilot: convert the kore `security` domain (#385).
- [ ] Pilot: convert the harness `guardrail` domain (#393).

### Exit Criteria

- The contributor guide shows the mocking patterns the pilots settled.

## Step 3: Convert Everything Else

One pull request per ticket, in parallel, as many as the test lock admits.
Label them all `ready-for-agent` when the pilots merge. Large domains are
split into batches of about 15 source files.

### Work

- [ ] Convert the rest of the kore package: 16 tickets (#375 to #384 except
      the pilot, and #423 to #428).
- [ ] Convert the rest of the harness package: 20 tickets (#386 to #401 except
      the pilot and the closed #391, and #429 to #434).

### Exit Criteria

- Every unconverted list is empty and deleted.
- Each package's full unit run takes under 20 s, and its unit coverage meets
  its thresholds.

## Step 4: Gate the Release and Lift the Pause

### Work

- [ ] Run integration tests after every merge and gate the release tag on
      them (#404).
- [ ] Measure and raise the unit test worker cap (#405).
- [ ] Remove the `paused` label from the frozen issues and pull requests, and
      the pause from the `Next:` lines of plans 2, 11, 12 and 13.

### Exit Criteria

- A failing integration test on main leaves no new release tag.
- No issue or pull request carries `paused`.

## Results
