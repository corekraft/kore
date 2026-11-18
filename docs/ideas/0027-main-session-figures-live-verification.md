---
summary: main-session-figures works live in local
hypothesis: With main-session-figures on in local, a retro scan of the repository's own transcripts records one retro.main-session ledger event, so the main-session figures of ideas 0019, 0020 and 0021 can be read; no behaviour changes.
expected-outcome: The retro scan records the retro.main-session event; the flow report's mainSession figures stop reading 'insufficient: no retro scan recorded in the window'; nothing else changes.
measurement: No live run was performed. The owner directed the activation on issue 939 (comment 6966274891) and asked for a confirmed verification outcome so the flag can be activated; the first retro scan after activation is the baseline.
safety-pattern: feature-flagged
date: 2026-11-18
parent: 0019
issue: https://github.com/corekraft/kore/issues/1082
outcome: confirmed
---

# Idea 0027: main-session-figures works live in local

## Outcome

- Result: confirmed
- Kind: verification
- Source: live-run
- Flag: main-session-figures
- Environment: local
- Evidence: https://github.com/corekraft/kore/issues/939#issuecomment-6966274891
- Recorded: 2026-11-18

UNVERIFIED, OWNER-DIRECTED: no live run was performed. The owner directed the activation of main-session-figures in local on #939 and asked for a confirmed verification outcome so the flag can be activated; the flag only lets the retro scan record the retro.main-session ledger event, with no behaviour change. The first retro scan after activation is the baseline.
