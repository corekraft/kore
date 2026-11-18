---
summary: proof for issue 225: a deliberately wrong claim, expected refuted and reverted
hypothesis: A one-line contributor-guide note about reading the flow report lowers tokensPerMergedChange.current. This claim is deliberately wrong: a docs note cannot lower the cost, and the proof on issue 225 expects it to be refuted and reverted.
expected-outcome: tokensPerMergedChange.current falls over a 1 day window. The proof expects it not to, so the evaluation reads refuted and the change is reverted.
measurement: tokensPerMergedChange.current from harness flow report, the 1 day after the change against the 1 day before. Proof idea for issue 225; it changes only a line of documentation.
safety-pattern: no-behaviour-change
date: 2026-11-18
kind: harness
hypothesis-metric: tokensPerMergedChange.current
hypothesis-direction: down
hypothesis-window: 1d
issue: https://github.com/corekraft/kore/issues/1258
---

# Idea 0042: Proof for 225: a deliberately wrong claim about tokens per merged change
