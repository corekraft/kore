---
summary: gated-help-exempt works live in local
hypothesis: With gated-help-exempt on in local, a writer's help request on a gated command is allowed and nothing the old guard refused for another reason is newly allowed, so no command leaves its worktree.
expected-outcome: The guardrail replay of role-no-merge between the refs before and after #1023 over the window since 2026-11-15 lists no newly allowed call.
measurement: harness guardrail replay --rule role-no-merge --old 613936c7 --new 898af688 --since 2026-11-15 examined 17259 recorded calls and listed none (empty, changed 0). Evidence comment on PR 1023.
safety-pattern: dark-launched
date: 2026-11-18
parent: 0022
issue: https://github.com/corekraft/kore/issues/1126
outcome: confirmed
---

# Idea 0039: gated-help-exempt works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: gated-help-exempt
- Environment: local
- Evidence: https://github.com/corekraft/kore/pull/1023#issuecomment-6967606657
- Recorded: 2026-11-18

Replay of role-no-merge between 613936c7 and 898af688 since 2026-11-15 examined 17259 recorded calls and listed no newly allowed call (empty, changed 0, exit 0). The owner directed enabling the flag after this gate.
