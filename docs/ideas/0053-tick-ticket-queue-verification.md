---
summary: Verification that the tick-ticket-queue flag turns on the frontier queue, its steering view and the harness label in local, so it can be activated.
hypothesis: With tick-ticket-queue on in local, harness queue next lists the open ready-for-agent issues in product-first, horizon order and names a reason for every excluded issue.
expected-outcome: queue next on the delivery host shows product tickets before harness work, horizon:next before horizon:then, and every paused, spec, blocked, assigned, sub-issue and grilling-source issue excluded with its reason.
measurement: Run harness queue next and queue next --json on the delivery host with the flag on, and compare the order and the exclusions with the owner's frontier search.
safety-pattern: feature-flagged
date: 2026-11-20
parent: 0052
issue: https://github.com/corekraft/kore/issues/1424
---

# Idea 0053: tick-ticket-queue works in local
