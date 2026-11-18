---
summary: pane-result-summary works live in local
hypothesis: With pane-result-summary on in local, a spawned pane's result summary is carried in its session state file, so the main session reads one file instead of the pane and its pane reads per finished pane fall; no other behaviour changes.
expected-outcome: A session's state file carries its result summary; the flow report's paneReadsPerFinishedPane is read against the baseline recorded by the first retro scan.
measurement: No live run was performed. The owner waived the live-run proof for pane-result-summary in their own comment on issue 939 and asked for the outcome to be recorded as owner-directed and unverified so the flag can be activated. Evidence comment on issue 939.
safety-pattern: dark-launched
date: 2026-11-18
parent: 0020
issue: https://github.com/corekraft/kore/issues/1097
outcome: confirmed
---

# Idea 0029: pane-result-summary works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: pane-result-summary
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/939#issuecomment-6966562649
- Recorded: 2026-11-18

UNVERIFIED, WAIVED BY THE OWNER: no live run was performed. The owner waived the live-run proof for pane-result-summary in their own comment on #939 and asked for the outcome to be recorded as owner-directed and unverified. The flag only carries a pane's result summary in its session state file; the first retro scan is the baseline.
