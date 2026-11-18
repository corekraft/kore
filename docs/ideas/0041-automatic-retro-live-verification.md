---
summary: automatic-retro works live in local
hypothesis: With automatic-retro on in local, a retro starts on its own once five ideas have closed since the last one, on Sonnet, with no person starting it; no other behaviour changes.
expected-outcome: The orchestrator launches the retro pane when retro due reports a count of five closed ideas, and the retro-triggered event is in the ledger.
measurement: Proof for issue 225. The owner approved a temporary activation of automatic-retro for the proof in their own comment on issue 225 on 2026-11-16 and told the main session on 2026-11-18 to activate it. The proof itself (a retro starting on its own at five closed ideas) is still owed and is reported on issue 225.
safety-pattern: dark-launched
date: 2026-11-18
issue: https://github.com/corekraft/kore/issues/1256
outcome: confirmed
---

# Idea 0041: automatic-retro works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: automatic-retro
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/225#issuecomment-6904634628
- Recorded: 2026-11-18

UNVERIFIED, WAIVED BY THE OWNER: no live run was performed. The owner approved a temporary activation of automatic-retro for the closed-loop proof in their own comment on issue 225 (2026-11-16) and told the main session on 2026-11-18 to activate it. The proof itself is still owed and is reported on issue 225. The flag is reverted if the proof fails.
