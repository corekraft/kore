---
summary: automatic-revert works in local (owner waiver)
hypothesis: With automatic-revert on in local, harness evaluate on a refuted harness idea opens a revert pull request for the change without a person writing the revert, declaring no-behaviour-change and never merged by the command (the judge merges it), and records the harness-change-reverted event once per idea. It returns status guardrail instead when the change edited the guardrail inventory, and fails when the ledger shows no merged pull request for the idea. It is on for the proof on issue 225 and is turned off again by editing the overlay in its own PR.
expected-outcome: harness evaluate --idea 0042 reads refuted, opens a revert/idea-1258 pull request, and the harness-change-reverted event is in the ledger.
measurement: Proof for issue 225: the owner waived live verification for automatic-revert in local, and the proof itself (a refuted idea reverted by the tool, a person running harness evaluate but not writing the revert) is still owed and reported on issue 225.
safety-pattern: dark-launched
date: 2026-11-18
issue: https://github.com/corekraft/kore/issues/1267
outcome: confirmed
---

# Idea 0044: automatic-revert works in local (owner waiver)

## Outcome

- Result: confirmed
- Kind: verification
- Source: owner-waiver
- Flag: automatic-revert
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/225#issuecomment-6984120814
- Recorded: 2026-11-18

OWNER WAIVER: no live run was performed. The owner waived live verification for automatic-revert in local for the closed-loop proof on issue 225 in their own comment. The proof itself is still owed and is reported on issue 225.
