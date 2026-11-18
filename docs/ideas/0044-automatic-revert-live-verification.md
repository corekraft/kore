---
summary: automatic-revert works live in local
hypothesis: With automatic-revert on in local, harness evaluate on a refuted harness idea opens a revert pull request for the change on its own, declaring no-behaviour-change and never merged by the command (the judge merges it), and records the harness-change-reverted event once per idea. It is on for the proof on issue 225 and is turned off again by editing the overlay in its own PR.
expected-outcome: harness evaluate --idea 0042 reads refuted, opens a revert/idea-1258 pull request, and the harness-change-reverted event is in the ledger.
measurement: Proof for issue 225. The owner approved a temporary activation of automatic-revert for the proof in their own comment on issue 225 on 2026-11-16 and told the main session on 2026-11-18 to activate it. The proof itself (a refuted idea reverted with no person involved) is still owed and is reported on issue 225.
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

UNVERIFIED, WAIVED BY THE OWNER: no live run was performed. The owner approved a temporary activation of automatic-revert for the closed-loop proof in their own comment on issue 225 (2026-11-16) and told the main session on 2026-11-18 to activate it. The proof itself is still owed and is reported on issue 225. The flag is turned off again by editing the overlay in its own PR once the proof idea is reverted.
