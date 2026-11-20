---
summary: Follow up on idea 0020 after a inconclusive outcome
hypothesis: After a inconclusive outcome on idea 0020, revisit: If session wait stores the pane result's summary in .kore/state/sessions/<name>.json and returns it in its JSON, the main session reads a finished pane's result from that record instead of scraping the pane with herdr agent read.
expected-outcome: The main session's herdr agent read and pane read calls per finished pane fall by at least three quarters, against 278 reads over 15-16 Nov, while tokens per merged change do not worsen.
measurement: mainSession.paneReadsPerFinishedPane in harness flow report, from the retro.main-session event retro-scan records from transcripts.
safety-pattern: feature-flagged
date: 2026-11-20
parent: 0020
---

# Idea 0065: Follow up: Carry a pane's result summary in its session state file
