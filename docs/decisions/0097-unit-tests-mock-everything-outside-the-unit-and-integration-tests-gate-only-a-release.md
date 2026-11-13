---
status: accepted
summary: A unit test exercises one class or function with every behaving dependency mocked; integration tests of real domains run only in CI and gate the release tag; cluster suites are renamed live tests.
date: 2026-11-12
last-verified: 2026-11-12
---

# ADR 0097: Unit tests mock everything outside the unit and integration tests gate only a release

Source: [`infra/plans/14-test-tiers.md` § Purpose](../../infra/plans/14-test-tiers.md#purpose)

## Context

Unit runs took 1m26s in `tools/kore` and 1m05s in `tools/harness` on the
owner's host (2026-11-12, two workers). Most spec files finished in under
0.2 s. The time went to a few files that run real `git`, `sh` and `bash`, to
tests that wait on real timers, and to specs that load many real modules to
test one. AGENTS.md asked only that fast tests need no cluster, so all of
these counted as unit tests and ran on every commit.

The owner decided that this wait is toil for people and agents, and paused
feature work until it is gone.

## Decision

- **A unit is one class,** or one function treated as a class with a single
  method. A unit test exercises one unit alone.
- **Everything outside the unit that has behaviour is mocked:** other units in
  the same domain, other domains, pure helpers, the process runner, the clock
  and the filesystem. Only types, error classes and constants are real. A unit
  test starts no process, waits on no real timer and uses no network.
- **Mocks are typed.** A collaborator passed to a constructor is a mock
  object. An imported module is an automock read through `vi.mocked`. A
  hand-written mock is for the cases an automock cannot express.
- **A domain is imported from outside only through its `index.ts`,** enforced
  by lint. Inside a domain, files import each other directly.
- **Each source file has exactly one spec file beside it.**
- **An integration test runs real units from built domains together.** It may
  run local processes and use temporary files, never a cluster or the network.
  The script, hook and bundle tests are integration tests.
- **The cluster suites are renamed live tests,** which frees the word
  "integration" for the tier above.
- **Gates.** The commit hook runs the unit tests related to the staged files.
  CI `check` runs the full unit suite. Integration tests never gate a commit.
  They gate a merge only for a change to `.claude/hooks` or
  `tools/kore/.husky`, because every checkout runs those from the working
  tree. They run nightly while domains convert and after every merge once all
  have, and a failing run stops the release tag. They can be run locally by
  an explicit command.
- **Budget.** A unit test takes under 100 ms, a unit spec file under 1 s, and
  a package's full unit run under 20 s. The budget fails the run for a
  converted domain from the day it converts; no audit period.
- **Coverage thresholds are measured on the unit run alone.**

Rejected:

- _Testing at a domain's public surface, with only other domains mocked._
  It survives refactors inside a domain, but a test still loads and runs the
  whole domain, and a failure does not name the unit at fault.
- _Using pure helpers for real._ It keeps some proof in the unit tier. The
  owner chose one rule with no judgement calls over that proof.
- _Gating every merge on integration tests._ Nothing consumes main except
  through a release, apart from the hooks, which keep their gate.

## Consequences

- No unit test proves that two real units work together. A mock that drifts
  from the unit it stands for passes every unit test; typed mocks catch a
  changed signature, and only integration and live tests catch changed
  behaviour.
- Main can hold a commit that fails integration tests. It is found after the
  merge or by the nightly run, not before, and a release waits until it is
  fixed.
- Unit tests know which file each collaborator lives in, so moving a unit
  between files changes its dependants' tests even when behaviour is the same.
- A change to the commit hooks is first tested in CI, not at commit.
- The budget skips the audit stage that AGENTS.md asks of new policies. A
  list of unconverted domains keeps main green while the rewrite lands one
  domain per pull request.
- Every existing unit spec is rewritten, about 400 files across both
  packages. Plans 2, 11, 12 and 13 are paused until it is done.
- Plan 7 keeps its direction: a function module is tested as a class with one
  method, so converting it to a class later does not change the rule.
