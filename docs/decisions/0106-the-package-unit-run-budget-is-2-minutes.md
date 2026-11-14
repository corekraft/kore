---
status: accepted
summary: A package's whole unit run must finish under 120 s instead of 20 s, a ceiling against regression on the owner's decision of 2026-11-14.
date: 2026-11-14
last-verified: 2026-11-14
---

# ADR 0106: The package unit-run budget is 2 minutes

Source: [`infra/plans/14-test-tiers.md` § Step 3](../../infra/plans/14-test-tiers.md#step-3-convert-everything-else)

Refines: ADR 0098

## Context

ADR 0098 set a package's whole unit run under 20 s. With every unconverted
list empty, CI measured 20.5 s for tools/kore on main and 26 s on a pull
request, startup and global setup included. The limit failed main and PRs on
runner noise, not on a regression.

## Decision

On the owner's decision of 2026-11-14, a package's whole unit run must finish
under 120 s (the `PACKAGE_MS` limit of the test-budget hook). The 100 ms per
test and 1 s per spec file rules, the slowest-file reporting and the coverage
thresholds are unchanged. No exemptions are added.

## Consequences

The budget is a ceiling against regression, not a target; the hook still prints
the slowest specs on every run. A run that takes 26 s now passes; one over 120 s
fails with the same message. Unit runs also use worker threads and four CI
workers, which leaves more headroom still.
