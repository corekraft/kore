---
status: accepted
summary: Refines ADR 0077: the release gate clears a flag from local proof of activation and flagged runtime behaviour, for every non-local environment including production; evidence freshness decides when that proof is stale.
date: 2026-11-23
last-verified: 2026-11-23
---

# ADR 0184: Local proof clears a flag for every non-local environment

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 4](../../infra/plans/11-agent-delivery-loop.md#step-4-feature-flags-and-activation-proof)

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md)

## Context

ADR 0077 and the "It just works" rule turn a flag on in an environment only
after a recorded live run in that environment, or an owner waiver
(ADR 0127). Each environment therefore repeats proof of the same unchanged
feature. The factory rule, decided by the owner, replaces that.

## Decision

- **Local is scratch.** A local run is where proof is gathered, not a release.
- **The release gate clears a flag from local proof.** It needs evidence that
  the flag was active locally and that the flagged behaviour actually worked
  at runtime; one artifact may show both. A design, a plan or CI status alone
  is not proof.
- **One clearance covers every non-local environment,** production included,
  for the same unchanged feature, with no staging-first run.
- **Evidence freshness decides staleness.** When old proof may not fit the
  candidate, the release gate asks evidence freshness, which answers `reuse`,
  `refresh` with the smallest local check, or `inconclusive` for missing
  provenance. It never grants clearance.
- **Clearance permits the flip; a release is the confirmed activation** in a
  named non-local environment.
- **`flag activate` accepts a recorded clearance** in place of a per-environment
  live outcome. An owner waiver still counts.

## Consequences

- The "It just works" rule in AGENTS.md is rewritten in the change that makes
  `flag activate` accept a clearance, not before, so no flag turns on under a
  rule its tool does not enforce. Until then ADR 0077 holds.
- A clearance needs provenance: the build, flag wiring and exercised path its
  proof ran on. That record is tracked as its own idea.
- Lab cases: `.claude/factory/release-gate/expectations.md`,
  `.claude/factory/evidence-freshness/expectations.md`.

## How this was decided

By the owner in the factory adoption session of 2026-11-23, after the herdr lab
passed every case for the factory roles in three consecutive runs.
