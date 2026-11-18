---
summary: main-session-wait works live in local
hypothesis: With main-session-wait on in local, harness wait returns on the first settled pull request or pane, so the main session waits in the background and its foreground poll minutes per merged change fall; no other behaviour changes.
expected-outcome: harness wait is usable by the main session in place of foreground polling; the flow report's foregroundPollMinutesPerMerged is read against the baseline recorded by the first retro scan.
measurement: No live run was performed. The owner waived the live-run proof for main-session-wait in their own comment on issue 939 and asked for the outcome to be recorded as owner-directed and unverified so the flag can be activated. Evidence comment on issue 939.
safety-pattern: dark-launched
date: 2026-11-18
parent: 0019
issue: https://github.com/corekraft/kore/issues/1095
outcome: confirmed
---

# Idea 0028: main-session-wait works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: main-session-wait
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/939#issuecomment-6966562649
- Recorded: 2026-11-18

UNVERIFIED, WAIVED BY THE OWNER: no live run was performed. The owner waived the live-run proof for main-session-wait in their own comment on #939 and asked for the outcome to be recorded as owner-directed and unverified. The flag only lets the main session use harness wait in place of foreground polling; the first retro scan after activation is the baseline.
