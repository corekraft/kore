---
summary: Put the writer's standing follow-up rules in writer.md
hypothesis: If writer.md states the rules the orchestrator retypes in follow-ups (merge origin/main, never rebase or force-push; keep CI green and never merge; run related tests, not the full suite; read a long run's output file rather than wait), follow-ups shrink and repeat corrections stop.
expected-outcome: The retro scan's repeated corrections on these themes, seen in 9, 6, 6, 5 and 4 sessions, fall to at most 1 session each.
measurement: metrics.tokensPerIdea in harness flow report, with the corrections list from hook retro-scan.
safety-pattern: no-behaviour-change
date: 2026-11-16
kind: harness
hypothesis-metric: metrics.tokensPerIdea
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/803
---

# Idea 0015: Put the writer's standing follow-up rules in writer.md
