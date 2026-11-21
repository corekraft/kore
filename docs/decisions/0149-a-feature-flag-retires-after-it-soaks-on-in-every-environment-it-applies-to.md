---
status: proposed
summary: A feature flag becomes eligible for retirement once it is on in every environment its manifest entry lists, each with its own outcome, for a soak with no revert; retirement is one contract-step pull request that deletes the flag, its off path and their tests, written through a harness flag retire tool that is built at horizon:then.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0149: A feature flag retires after it soaks on in every environment it applies to

Source: [issue #1479](https://github.com/corekraft/kore/issues/1479), grilled against the owner interview record in [issue #1478](https://github.com/corekraft/kore/issues/1478) (decision 1).

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md), which says removing a flag is part of the contract step but gives no rule, and [ADR 0107](0107-the-judge-precheck-accepts-a-contract-once-its-expand-step-is-proven.md).

## Context

Flags that stay on everywhere keep their off path, its tests and the conditionals in charts and code for ever. The owner decided that once vps v1 has soaked, flags that are on everywhere they apply become permanent: the flag, its off path and their tests are deleted. This is not v1 work (`horizon:then`).

## Decision

- **Eligibility** is read from the flag manifest ([ADR 0148](0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md)). A feature flag is eligible when it is on in every environment its entry lists, each with its own recorded outcome, for the soak after the latest of those activations, with no revert and no flag-off event for it in the ledger in that window. Environment and harness flags are never eligible.
- **Retirement is one contract-step pull request.** Its expand steps are the activations (ADR 0107). It deletes the flag from every overlay and from the manifest, the code constant and its off path, the chart conditionals, the off-path tests, and any spec that lists the flag.
- **`harness flag retire <flag>` owns the write.** It refuses an ineligible flag, removes the overlay and manifest entries, records a `flag.retired` ledger event and prints every remaining reference to the name for the writer to delete. Recorded outcomes stay: ledgers are append-only.
- **Build it later.** The tool is built at `horizon:then`; this ADR fixes the rule now so no flag is added without an entry the rule can read.

## Consequences

- A retired flag cannot be turned off again as a rollback; after retirement the way back is a revert of the retirement pull request.
- Contract steps wait for the soak, as the owner's rollback decision says.

## Open owner decisions

- **The soak length.** The record gives none and no ADR or plan sets one. Proposal: 14 days. Nothing depends on it before `horizon:then`.
