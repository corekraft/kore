---
summary: Implements ADR 0182 behind factory-orchestrator: a step no rule decides goes from the orchestrator role to the advisor with a fixed handoff, in place of a judgment pane.
hypothesis: Routing a stalled step through the orchestrator role's fixed handoff to the advisor removes guessed recovery routes and keeps the tick deterministic.
expected-outcome: Every stalled step in the window reaches the advisor with criteria, stop reason, branch, diff and done, unverified and remaining work, and no judgment pane is spawned.
measurement: Read the ledger's stall, handoff and decision events for 14 days after factory-orchestrator turns on in local.
safety-pattern: feature-flagged
date: 2026-11-24
issue: https://github.com/corekraft/kore/issues/2020
---

# Idea 0089: The tick hands a stalled step to the orchestrator and the advisor
