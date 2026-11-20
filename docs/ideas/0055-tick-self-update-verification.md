---
summary: Verification that the tick-self-update flag pulls a clean main and rebuilds the harness bundle between tick passes in local, so it can be activated. Turning it on needs this idea's recorded verification outcome and the owner's one-line approval.
hypothesis: With tick-self-update on in local, the tick loop pulls a clean main by fast-forward and rebuilds the harness bundle between passes, so a merged harness change reaches the running tick within one loop interval; a checkout that is dirty, off main or not fast-forward-able, a failed fetch or a failed build keeps the old bundle, reports its message and fix, records the failure on the ledger, and never ends the loop.
expected-outcome: On the delivery host, after a harness change merges to main, the next pass runs on a bundle built from the new main commit with no manual pull; with a deliberately dirty checkout the update is refused, the failure is printed with its fix and recorded, and the loop's next pass still runs; an unexpected error is not swallowed.
measurement: On the delivery host, read git log and the bundle's mtime across one merge, the loop's stdout and stderr, and the ledger's tick self-update events over the first loop run after activation: the ledger kind is tick.self-update-failed (tools/harness/src/ledger/schema-kinds.ts, tools/harness/src/orchestrator/tick-self-update.ts), and a successful pull and rebuild writes no ledger event, so its proof is the git log and bundle mtime.
safety-pattern: feature-flagged
date: 2026-11-20
parent: 0052
issue: https://github.com/corekraft/kore/issues/1445
---

# Idea 0055: tick-self-update works in local

This idea verifies the `tick-self-update` flag in the local environment. The flag stays off: turning it on needs this idea's recorded verification outcome and the owner's one-line approval. Nothing here activates the flag or edits an environment overlay.
