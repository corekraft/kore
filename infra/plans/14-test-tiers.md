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
[ADR 0097](../../docs/decisions/0097-unit-tests-mock-everything-outside-the-unit-and-integration-tests-gate-only-a-release.md);
the terms are in [`GLOSSARY.md`](../../GLOSSARY.md) (Testing). Tracking issue:
#371.

## Step 1: Free the Names and Add the Integration Tier

Next: Merge the pull request that adds this plan and ADR 0097, then label #372 `ready-for-agent`. #372 (live rename), then #373 (integration tier), then #374 (budget, barrel lint, one spec per unit), in that order. Full state: #371.

### Work

- [ ] Rename the cluster suites to live tests (#372).
- [ ] Add the integration tier and move the script, hook and bundle tests
      into it (#373).
- [ ] Enforce the unit test budget, the barrel rule and one spec per unit,
      with a list of unconverted domains (#374).

### Exit Criteria

- A unit run starts no process.
- The budget fails the run for a converted domain, and the unconverted list
  holds every domain.

## Step 2: Convert Every Domain

One pull request per domain, in parallel, as many as the test lock admits.
Label each `ready-for-agent` once #374 merges.

### Work

- [ ] Convert the 11 `tools/kore` domains (#375 to #385), `platform` and
      `runtime` first.
- [ ] Convert the 18 `tools/harness` domains (#386 to #403).

### Exit Criteria

- The unconverted list is empty.
- Each package's full unit run takes under 20 s, and its unit coverage meets
  its thresholds.

## Step 3: Gate the Release and Lift the Pause

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
