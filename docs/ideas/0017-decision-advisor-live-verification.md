---
summary: decision-advisor works live in local
hypothesis: With decision-advisor on in a local checkout, an advisor pane decides one non-reserved question under the kore-orchestrator App identity, records decision.made, and the tool refuses a reserved category with nothing posted.
expected-outcome: The advisor comment posts with the sender line from app/kore-orchestrator, decision.made is in the ledger, and a reserved-category decision is refused.
measurement: A live run in a scratch worktree with the flag on: comment URL https://github.com/corekraft/kore/issues/795#issuecomment-6918446149, the decision.made event with label model-choice, and the destruction refusal text (ADR 0120).
safety-pattern: feature-flagged
date: 2026-11-16
parent: 0008
issue: https://github.com/corekraft/kore/issues/916
outcome: confirmed
---

# Idea 0017: decision-advisor works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: decision-advisor
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/795#issuecomment-6918446149
- Recorded: 2026-11-16

advisor decided one question under app/kore-orchestrator, decision.made recorded, reserved category refused
