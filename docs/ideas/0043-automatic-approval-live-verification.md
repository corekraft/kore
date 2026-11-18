---
summary: automatic-approval works live in local
hypothesis: With automatic-approval on in local, harness approve labels a qualifying harness idea ready-for-agent on its own and posts the reason first; an idea that does not qualify is left for a person with the reason. It is on for the proof on issue 225; it is turned off again by reverting its activation commit in its own PR.
expected-outcome: harness approve --idea 0042 labels the proof idea ready-for-agent with the reason posted first and one idea.approved event in the ledger.
measurement: Proof for issue 225. The owner approved a temporary activation of automatic-approval for the proof in their own comment on issue 225 on 2026-11-16 and told the main session on 2026-11-18 to activate it. The proof itself (the auto-approval of the proof idea) is still owed and is reported on issue 225.
safety-pattern: dark-launched
date: 2026-11-18
issue: https://github.com/corekraft/kore/issues/1259
outcome: confirmed
---

# Idea 0043: automatic-approval works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: automatic-approval
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/225#issuecomment-6904634628
- Recorded: 2026-11-18

UNVERIFIED, WAIVED BY THE OWNER: no live run was performed. The owner approved a temporary activation of automatic-approval for the closed-loop proof in their own comment on issue 225 (2026-11-16) and told the main session on 2026-11-18 to activate it. The proof itself is still owed and is reported on issue 225. The flag is turned off again by reverting its activation commit once the proof idea is approved.
