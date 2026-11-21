---
status: proposed
summary: The platform, not the owner or a decider, turns an app flag on when the criteria its manifest pre-registered hold over the rollout's soak window and the exposure is a controlled rollout (flag, canary or dark launch), recording an outcome; this revises ADR 0120's reserved list and the AGENTS.md flag rule for platform-owned app flags only, and `harness flag activate` stays the rule for the platform's own flags.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0173: The platform turns an app flag on under a controlled rollout

Source: [#1485](https://github.com/corekraft/kore/issues/1485), decision 15 of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478), and the owner's answer on #1485 (2026-11-20): "the platform may turn an app flag on when it meets its criteria, as long as the exposure is a controlled rollout (feature flag, canary or dark launch), since something has to be on to produce the data"

Refines: [ADR 0077](0077-live-proof-gates-activation-not-merge.md) (live proof gates activation)

Revises: [ADR 0120](0120-recommended-decisions-go-to-an-advisor-reserved-decisions-to-the-owner.md) (its reserved list names "turning a flag on"), and the AGENTS.md rule that only `harness flag activate` turns a flag on

## Context

AGENTS.md says only `harness flag activate` turns a flag on, after a recorded
live-run outcome for that flag and environment. ADR 0120 reserves "turning a flag
on" to the owner. Both were written for the platform's own flags, which change
what runs in a cluster and have no data until something is on. Record 15 says
only the platform activates an application's flag, from live evidence and a
recorded outcome. Evidence cannot exist before exposure, so the platform has to
be able to expose an application flag to a controlled share of use to produce
it. Waiting for the owner or a decider on every flag would make the owner the
bottleneck again.

## Decision

- **The platform activates app flags.** For a platform-owned app flag (declared
  in an application's manifest, state held by the platform), the platform turns
  it on when the criteria the manifest pre-registered hold. No owner and no
  decider call is needed. The owner decided this once, as a rule, not per flag.
- **Only under a controlled rollout.** Each flag's manifest declares its rollout:
  a kind (`flag`, `canary` or `dark-launch`), the criteria (what is read from
  evidence and the thresholds), and the soak window. The window is a per-rollout
  primitive, set by the app, as short as hours; if the criteria hold over it, that
  is enough. The platform refuses a flag with no rollout, no criteria or no
  window, and refuses a kind it has not built; v1 builds `flag` and `dark-launch`,
  and `canary`, which splits traffic, is refused until a later decision builds it.
- **A recorded outcome.** Turning a flag on records an outcome naming the app,
  the flag, the criteria, the evidence over the window and the result, mirroring
  `harness outcome record`. A refuted or inconclusive result leaves the flag off
  and calls the decider; the platform never retries a refuted flag without a new
  release. Turning a flag off needs no criteria and goes first in the queue.
- **The scope is narrow.** This revises the reserved list and the AGENTS.md rule
  for platform-owned app flags only. `harness flag activate` and the recorded
  live-run outcome stay the rule for every flag in an environment overlay, the
  platform's own flags. The `app-delivery` flag that holds this machinery is one
  of those: it turns on through `harness flag activate` after its live outcomes.
- **Evidence belongs to concept 8.** What counts as evidence, how it is collected
  and kept, and the exact outcome fields are settled in #1486; this ADR fixes who
  acts and under what exposure.

- **See also [ADR 0174](0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md).** It fixes the evidence an activation reads; this ADR fixes who activates and under what exposure.

## Consequences

- AGENTS.md and ADR 0120 are revised in a follow-up that references this ADR: the
  flag rule names platform-owned app flags as activated by the platform, and the
  reserved list's "turning a flag on" excludes them.
- The platform needs an injectable evidence source and an outcome record for app
  flags before it can activate one; until then no app flag turns on.
- An app author controls the criteria and the window, so a weak criterion can
  expose a flag early. The exposure is still dark and controlled, and a flag off
  and a revert stay available at any time.
