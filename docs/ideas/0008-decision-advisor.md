---
summary: Send recommended decisions to an advisor role, not the owner
hypothesis: If a question that carries a recommendation goes to a read-only Sonnet advisor that records the decision on the issue, and only data destruction, guardrail mode, credentials and spend wait for the owner, owner minutes per merged change fall.
expected-outcome: Owner minutes per merged change fall, and at most 1 in 10 decisions reaches the owner, against 101 questions in four days of which the owner took the first option 94 times.
measurement: outcomes.ownerMinutes.perMerged in harness flow report, with advisor decisions counted from their ledger events.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: outcomes.ownerMinutes.perMerged
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/795
---

# Idea 0008: Send recommended decisions to an advisor role, not the owner
