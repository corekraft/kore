---
summary: shell-aware-zsh-rules works live in local
hypothesis: With shell-aware-zsh-rules on in local and a verified bash shell, the unquoted-glob, equals-word and bare-glob rules stop blocking or warning on legitimate commands, no changed command leaves its worktree or role, and the guard corpus still blocks every known-bad case.
expected-outcome: Every changed verdict goes from block or warn to allow, only for a verified bash; an unknown or missing shell and zsh behave as before; the corpus passes.
measurement: A comparison over 18704 recorded Bash calls since 2026-11-12 with the flag off and with SHELL=/bin/bash and the flag on: 1452 changed verdicts, all block or warn to allow, 1424 allowed as a writer; the corpus (841 tests) passes; a rewritten glob runs the same under zsh 5.9 and bash 3.2.57. Evidence comment on issue 865.
safety-pattern: feature-flagged
date: 2026-11-17
parent: 0011
issue: https://github.com/corekraft/kore/issues/985
outcome: confirmed
---

# Idea 0024: shell-aware-zsh-rules works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: shell-aware-zsh-rules
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/865#issuecomment-6950525892
- Recorded: 2026-11-17

Compared 18704 recorded Bash calls with the flag off and on under bash: 1452 changed verdicts, all block or warn to allow, none leaving its worktree or role; corpus passes; owner also waived further proof on #798.
