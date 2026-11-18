---
summary: signed-main-sends works live in local
hypothesis: With signed-main-sends on in local, the main session's sends to panes carry a sender line, so the signed share of its sends rises from the baseline recorded by the first retro scan; no other behaviour changes.
expected-outcome: The main session's pane sends are signed; the flow report's signedSendShare is read against the baseline recorded by the first retro scan.
measurement: No live run was performed. The owner waived the live-run proof for signed-main-sends in their own comment on issue 939 and asked for the outcome to be recorded as owner-directed and unverified so the flag can be activated. Evidence comment on issue 939.
safety-pattern: dark-launched
date: 2026-11-18
parent: 0021
issue: https://github.com/corekraft/kore/issues/1099
outcome: confirmed
---

# Idea 0030: signed-main-sends works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: signed-main-sends
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/939#issuecomment-6966562649
- Recorded: 2026-11-18

UNVERIFIED, WAIVED BY THE OWNER: no live run was performed. The owner waived the live-run proof for signed-main-sends in their own comment on #939 and asked for the outcome to be recorded as owner-directed and unverified. The flag only signs the main session's pane sends; the first retro scan is the baseline.
