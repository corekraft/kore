---
status: accepted
summary: A recorded outcome may carry source owner-waiver, backed by a GitHub comment URL, as the proof for a flag in an environment; findProof names which source it found, flag audit names a waiver apart from a live run, and a waiver never counts for a cluster-facing no-behaviour-change.
date: 2026-11-18
last-verified: 2026-11-18
---

# ADR 0127: An owner waiver recorded in an outcome counts as proof for a flag

> Refined by [ADR 0147](0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md) (proposed): on vps, `flag activate` refuses `--source owner-waiver`, so the waiver narrows to local. It stays valid for local.

Source: ticket [#1265](https://github.com/corekraft/kore/issues/1265); the owner waived live verification of automatic-revert in local on issue [#225](https://github.com/corekraft/kore/issues/225) (comment 6984120814).

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md), which makes a confirmed live-run verification the only proof that turns a flag on. The owner chose this route on 2026-11-18 ("A") in the main session; the ticket records that choice.

## Context

`findProof` accepted only `Result: confirmed`, `Kind: verification`, `Source: live-run`, and the flag and environment. When the owner waives a live run, the only way to turn the flag on was to fill those fields while the outcome text said no run was performed. Judges sent PR #1264 back for that.

## Decision

- **A waiver is a source, not a result.** `harness outcome record` accepts `--source owner-waiver` for `--kind verification` only, and requires `--evidence` to be the URL of the GitHub comment where the owner waived the run (an issue or pull request comment). The outcome records `Source: owner-waiver`; it never claims a live run.
- **`findProof` counts it.** A confirmed verification with `Source: owner-waiver` for the same flag and environment is proof, and `findProof` returns the source it found. A live run found for the same flag and environment is preferred over a waiver.
- **The waiver stays visible.** `flag activate` says when it turned a flag on under a waiver, and `flag audit` lists each flag that rests on a waiver apart from the unproven ones. It still passes: a waiver is proof on record, and the line keeps the owner's choice in view.
- **It never reaches a cluster-facing `no-behaviour-change`.** That pattern has no flag, so nothing reads a waiver for it, and it still needs a live run before merge.
- **Expand-contract.** `live-run` stays valid as it was. Recorded outcomes are not edited: only the outcome tool writes those fields, so an outcome that filled `live-run` without a run is corrected by the owner's decision, not by hand.

## Consequences

An owner waiver is a recorded, citable decision rather than a false live run. The cost is one more accepted source in the outcome vocabulary and one more line in the audit.
