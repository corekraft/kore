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

## Notes

### Cut of the related-tests corrections (#849, recorded on #803 on 2026-11-16)

The cut is read-only over session transcripts. It classifies each follow-up to a writer session about related tests or the full suite as habit (the session had already run a full suite) or real break (the related tests missed a break).

- Before #553: 33 sessions with habit follow-ups, 2 with real breaks; 54 follow-ups counted: 49 habit, 2 real break, 3 dropped.
- After #553: 4 sessions with habit follow-ups, 1 with real breaks; 19 follow-ups counted: 6 habit, 4 real break, 9 dropped.
- Owner of "run related tests, not the full suite": writer.md, alone (advisor decision on #803, 2026-11-17).

Habit corrections fell from 49 to 6 after #553, and dominate, so the rule's one owner is writer.md. The 4 real breaks after #553 are a test-selection problem that no rule sentence fixes; they are left to the outcome read, not given a second owner. The keyword classification is approximate and the samples are small.
