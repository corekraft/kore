---
summary: Each writer's lifetime stays strictly under 100,000 cumulative active tokens and hands back its work before the limit.
hypothesis: Counting a writer's cumulative active tokens, which idle time and compaction never reset, and stopping it with a handoff before 100,000 keeps every writer inside one small ticket.
expected-outcome: No writer session passes 100,000 cumulative active tokens, and every writer stopped by the budget leaves a handoff with its branch, diff, checks run and remaining work.
measurement: Read each writer session's cumulative token count and its report from the ledger for 14 days after the flag turns on in local.
safety-pattern: feature-flagged
date: 2026-11-24
issue: https://github.com/corekraft/kore/issues/1988
---

# Idea 0086: Writers stop below a 100K cumulative token budget
