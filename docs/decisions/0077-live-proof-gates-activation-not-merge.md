---
status: accepted
summary: Live proof of a cluster-facing change gates turning it on in an environment, not merging it, except for changes declared no-behaviour-change.
date: 2026-11-11
last-verified: 2026-11-11
---

# ADR 0077: Live proof gates activation, not merge

Source: [`infra/plans/11-agent-delivery-loop.md` § Step 4](../../infra/plans/11-agent-delivery-loop.md#step-4-feature-flags-and-activation-proof)

Refines: the "It just works" rule in [`AGENTS.md`](../../AGENTS.md#platform).

## Context

AGENTS.md says a change to what runs in a cluster is done only when a live run
proves it, before merge. That rule makes every cluster-facing merge wait on a
live cluster, which blocks trunk-based development and delivery on autopilot.
Under trunk-based development, a change that is merged but switched off cannot
cause friction for a user. What must be proven live is the moment a change
starts to affect an environment.

## Decision

Every change declares a safety pattern: `no-behaviour-change`,
`feature-flagged`, `dark-launched`, `branch-by-abstraction`, or
`expand-contract`. A flagged or dark-launched change may merge before a live
run. Live proof is required before its flag or launch turns on in an
environment, and that proof is recorded as the verification outcome. A change
declared `no-behaviour-change` that touches the cluster still needs a live run
before merge, because nothing gates it afterwards.

Feature flags are a `features:` map in each environment overlay, validated by
schema and off by default. Dark launch means a feature is on only in `local`.
There is no runtime flag service. Removing a flag after its outcome is
confirmed is part of the contract step.

## Consequences

AGENTS.md's "It just works" rule is rewritten in the step that adds feature
flags, not before, so no change can merge unproven without a flag to hold it.
The judge checks the declared pattern against the diff. Activation becomes an
explicit, audited event with live evidence attached.

## Refinement: a catalog component can be gated by a flag

A flag that only reaches chart values cannot hold back a whole component, which
the dark-launch pattern needs when a new controller is cataloged before it is
proven. A catalog component may set `featureFlag: <name>`, a flag declared in
the environment's `features:` map.

- Validation fails, naming the component, when the environment does not declare
  the flag (set it to `false` to keep the component off).
- A gated component is validated, pinned and rendered like any other. With the
  flag off, `kore local up` and `kore platform up` issue no command for it and
  `kore platform status` reports it as `gated-off`, not `missing`. A gated-off
  component is not a readiness prerequisite, so it never holds the admission
  gate shut. Turning the flag on installs it in its normal dependency order.
- Components without `featureFlag` behave exactly as before.
- An enabled component may not depend on a gated-off one; validation rejects
  it. Namespace enrollment and the image inventory skip a gated-off
  component's namespace, since nothing creates it.
- A flag turned off after install leaves a release nothing owns. For a gated-off
  Helm component, status does a read-only `helm status`: a remaining release
  reports `degraded` with the uninstall command and the option to turn the flag
  back on, `up` fails fast with the same message before installing anything,
  and enrollment and the image inventory keep covering its namespace while the
  release exists.
- A gated-off status does not fail `kore platform status`. A readiness
  requirement whose components are all gated off is recorded `skipped`, not
  `ready`. The platform generation includes each gating flag's value.
