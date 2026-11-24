---
summary: A clearance's proof records its build, flag wiring and exercised path, so evidence freshness can reuse it or name the smallest refresh.
hypothesis: Recording the tested commit, the flag wiring and the exercised path with each local proof lets evidence freshness answer reuse or refresh for a candidate instead of inconclusive.
expected-outcome: Every new release-gate clearance carries provenance, and evidence freshness returns inconclusive only for proof recorded before this change.
measurement: Count clearances with provenance and evidence freshness dispositions by kind over the first 14 days after the flag turns on in local.
safety-pattern: feature-flagged
date: 2026-11-24
issue: https://github.com/corekraft/kore/issues/1989
---

# Idea 0087: Release proof records the build it ran on
