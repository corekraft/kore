---
summary: automatic-revert works live in local
hypothesis: With automatic-revert on in local, harness evaluate on a refuted harness idea opens a revert pull request for the change without a person writing the revert (it returns status guardrail instead when the change edited the guardrail inventory, and fails when the ledger shows no merged pull request for the idea), declaring no-behaviour-change and never merged by the command (the judge merges it), and records the harness-change-reverted event once per idea. It is on for the proof on issue 225 and is turned off again by editing the overlay in its own PR.
expected-outcome: harness evaluate --idea 0042 reads refuted, opens a revert/idea-1258 pull request, and the harness-change-reverted event is in the ledger.
measurement: Proof for issue 225. The owner approved a temporary activation of automatic-revert for the proof in their own comment on issue 225 on 2026-11-16 and told the main session on 2026-11-18 to activate it (recorded at https://github.com/corekraft/kore/issues/225#issuecomment-6983782175). The proof itself (a refuted idea reverted by the tool, with a person running harness evaluate but not writing the revert) is still owed and is reported on issue 225.
safety-pattern: dark-launched
date: 2026-11-18
issue: https://github.com/corekraft/kore/issues/1263
outcome: confirmed
---

# Idea 0044: automatic-revert works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: automatic-revert
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/225#issuecomment-6904634628
- Recorded: 2026-11-18

UNVERIFIED, WAIVED BY THE OWNER: no live run was performed, so the Result, Source and Evidence fields above are not a live-run proof. They are the fields the flag gate reads (`flag activate` refuses without them), and the owner chose to waive the run for this proof instead of changing the gate. The owner approved a temporary activation of automatic-revert for the closed-loop proof in their own comment on issue 225 (2026-11-16) and told the main session on 2026-11-18 to activate it; that instruction is recorded at https://github.com/corekraft/kore/issues/225#issuecomment-6983782175. The flag was turned on through `harness flag activate` with this outcome, not by a hand edit. The proof itself is still owed and is reported on issue 225. The flag is turned off again by editing the overlay in its own PR once the proof idea is reverted.
