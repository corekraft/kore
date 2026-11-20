---
summary: proof for issue 225: a deliberately wrong claim, expected refuted and reverted
hypothesis: A one-line contributor-guide note about reading the flow report lowers metrics.sessionsPerIdea. This claim is deliberately wrong: a docs note cannot lower sessions per idea, and the proof on issue 225 expects it to be refuted and reverted.
expected-outcome: metrics.sessionsPerIdea falls over a 1 day window. The proof expects it not to, so the evaluation reads refuted and the change is reverted.
measurement: metrics.sessionsPerIdea from harness flow report, the 1 day after the change against the 1 day before. Proof idea for issue 225; it changes only a line of documentation.
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: metrics.sessionsPerIdea
hypothesis-direction: down
hypothesis-window: 1d
issue: https://github.com/corekraft/kore/issues/1258
outcome: inconclusive
---

# Idea 0042: Proof for 225: a deliberately wrong claim about sessions per idea

## Outcome

- Result: inconclusive
- Kind: experiment
- Source: comparison
- Evidence: ledger flow metric metrics.sessionsPerIdea: 1d before 2026-11-18T15:40:14.000Z against the 1d after
- Recorded: 2026-11-20

metrics.sessionsPerIdea went from 0 to 0 (expected down, noise threshold 10%): insufficient history.
