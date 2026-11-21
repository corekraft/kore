---
status: proposed
summary: A platform release reaches vps through a judge-merged pull request that admits its signer and a recorded rollout run from kore-agents at its tag, never scheduled in v1; a rollback is a git revert and a rollout, never helm rollback, and a flag turned off is not a rollback until its leftover release is explicitly uninstalled.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0150: Platform releases reach vps by a recorded rollout and roll back by revert

Source: [issue #1479](https://github.com/corekraft/kore/issues/1479), grilled against the owner interview record in [issue #1478](https://github.com/corekraft/kore/issues/1478) (decisions 7, 12 and the gap on delivering the platform itself).

Refines: [ADR 0043](0043-platform-configuration-through-argo-cd.md) and [ADR 0044](0044-managed-platform-images-from-the-mirror.md).

## Context

The platform's charts, controllers and images change on every release. On vps nothing says how a release arrives, what a failed arrival does, or how it is undone. Two facts shape it: the configuration phase is owned by Argo CD while `platform-argocd-delivery` is on and the early phases by `kore` through Helm, so a `helm rollback` of the first would be undone by self-heal; and a gated-off Helm component with a leftover release makes `kore platform up` fail fast (ADR 0077 refinement), so turning a flag off does not remove what it installed.

## Decision

- **A release arrives in two steps.** A judge-merged pull request adds the release's signer to the vps image policy and passes `kore validate --platform-image-lock` against the release asset (the ADR 0044 pattern). Then an explicit rollout run, `kore platform up --environment vps` from kore-agents at that tag, triggered by the main session or the orchestrator and never scheduled in v1. It records a `platform.rolled-out` ledger event naming the tag and the chart and image lock digests.
- **Staying behind is allowed.** vps stays on its last rolled-out tag; nothing rolls out automatically.
- **A failed rollout stops at the first red readiness check,** names the cause and makes no further change. The session may rerun once for a transient cause. Otherwise the answer is a revert pull request, judged and rolled out from the previous tag, never a manual partial repair. The last good rollout is the latest `platform.rolled-out` event, and a read-only `kore platform status --environment vps` compared with it is the drift check.
- **Rollback is a revert.** A configuration-phase release (Argo CD) rolls back by `git revert` of its record. A core-phase release (Helm, `kore`) rolls back by `git revert` and a rollout run. Neither uses `helm rollback`.
- **Flag off is not a rollback by itself.** A rollback by flag-off ends with the explicit uninstall command naming the environment and release, under the existing destructive-consent gate, never as automatic pruning.
- **Pin upgrades** reach vps only after the same pins ran in local with their compatibility evidence attached, then in a rollout run. A pin upgrade that changes a CRD is declared `expand-contract` and is forward-only once rolled out: the pull request says so, a revert is not offered, and recovery rolls forward.

## Consequences

- Every change to production's platform is a recorded event with the tag and lock digests, so drift is a comparison, not a guess.
- A CRD-changing upgrade cannot be undone; its proof is the local run and its safeguard is the review.

## Open owner decisions

- **How stale vps may be.** An orchestrator notice, not a block, when vps lags the latest release by more than 30 days or by any release whose notes carry a security fix. The figure and the trigger are proposals; the record has no lag limit.
