---
summary: Run the orchestrator as a tick over the ledger and queue
hypothesis: If orchestrate run drives spawn, wait, precheck and close from the ledger and queue, and calls a model only for a judgment with a small fresh context, tokens per idea fall.
expected-outcome: Tokens per closed idea fall by at least 30 percent, and no orchestrator turn carries more than 60k tokens of context, against a median of 255k over 7,236 turns on 2026-11-12 to 2026-11-16.
measurement: metrics.tokensPerIdea in harness flow report, with the orchestrator share read from token.usage events per session.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: metrics.tokensPerIdea
hypothesis-direction: down
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/794
---

# Idea 0007: Run the orchestrator as a tick over the ledger and queue

- **Window.** Its 14-day window also records whether `main-session-wait` and
  `pane-result-summary` were on (ADR 0123), so the reverse confounding is
  visible: ideas 0019 and 0020 move the main session's waits and reads, and
  would move this idea's tokens per idea.
