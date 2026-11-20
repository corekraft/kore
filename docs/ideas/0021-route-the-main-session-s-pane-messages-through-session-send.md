---
summary: Route the main session's pane messages through session send
hypothesis: If session send confirms a message that wraps in the target pane instead of reporting it undelivered, and the main session's brief names session send, the main session stops typing into panes with raw herdr and its follow-ups carry a sender line.
expected-outcome: The signed share of the main session's pane sends rises from 5 of 45 over 15-16 Nov to at least 90 percent, while repeated-correction clusters do not worsen.
measurement: mainSession.signedSendShare in harness flow report, session send over session send plus raw herdr agent prompt, pane send-text and send-keys, from the retro.main-session event retro-scan records from transcripts.
safety-pattern: feature-flagged
date: 2026-11-16
kind: harness
hypothesis-metric: mainSession.signedSendShare
hypothesis-direction: up
hypothesis-window: 14d
issue: https://github.com/corekraft/kore/issues/938
outcome: refuted
---

# Idea 0021: Route the main session's pane messages through session send

Decided in [ADR 0123](../decisions/0123-the-main-session-waits-and-sends-through-harness-tools-not-guards.md).

- **No guard.** The idea as filed had the guard block raw herdr sends; ADR
  0091 freezes new guards and ADR 0120 says no new guard rule for this gap.
- **The cause.** `session send` and `session notify` confirm delivery by
  finding the whole signed message on one pane line, so a message wider than
  the pane is reported undelivered though it arrived. Confirmation moves to the
  pane text with wrapped lines rejoined, still excluding the input box.
- **The flag.** `signed-main-sends`, off in every overlay, gates the new
  confirmation and one line of the main session's SessionStart brief that names
  `session send`; flag off keeps today's confirmation exactly.
- **The primary.** The signed share of the main session's pane sends, up, read
  as `mainSession.signedSendShare` in the flow report from the scan's
  `retro.main-session` event. `rework.mainFollowUpsPerWriterSession` is counted
  from the `session.send` events the changed path writes, so it fails ADR 0119's
  independence test and is not this idea's primary.
- **Parked for the owner.** Whether the owner digest counts the main session's
  bare herdr sends, and learns `herdr agent prompt`, is a reserved question
  (ADR 0120); this idea does not depend on it.

## Outcome

- Result: refuted
- Kind: experiment
- Source: comparison
- Evidence: 44 signed sends vs 890 raw: signed share 4.7%, target at least 90% (n=890)
- Recorded: 2026-11-20

The signed share of sends is 4.7% (44 of 890), against a target of at least 90%; follow-up is idea 0035.
