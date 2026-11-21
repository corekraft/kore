---
status: proposed
summary: The platform polls each application's repository for signed candidates, copies one into the cluster registry, opens a bump pull request through its own identity, and the judge merges it by a deterministic checklist; Argo CD deploys it dark, and a deploy that is not healthy in 15 minutes is reverted through git and its digest is never bumped again.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: The platform bumps the app record and the judge merges it dark

Source: [#1485](https://github.com/corekraft/kore/issues/1485), decisions 6, 7, 12 and 14 of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478)

Refines: [ADR 0043](0043-platform-configuration-through-argo-cd.md) (the golden-path ApplicationSet), [ADR 0107](0107-the-judge-precheck-accepts-a-contract-once-its-expand-step-is-proven.md)

Builds on: the trust ADR for the platform workflow (draft `XXXX-app-images-are-trusted-by-the-platform-workflow-identity-and-three-attestations`)

## Context

An application commits freely to its own repository (record 14) and the
platform decides what reaches the cluster (record 12). Git stays the desired
state, and Argo CD owns the release (record 7), so a rollout is a change to the
record in this repository and a rollback is a `git revert` of it or a flag off,
never `helm rollback`. Today the golden-path ApplicationSet deploys one
`templateImages` digest from the release lock to every service, and a `Service`
record holds no digest, repository or rejected list.

## Decision

- **Pull, not push.** A platform step on `kore-agents` polls each registered
  application repository every 60 seconds for new signed digests and verifies
  them itself. No application repository holds a token for this repository, and
  no application can trigger a bump by calling in. One bump is in flight per
  application, and a newer candidate supersedes a queued one but never one that
  merged.
- **One release, one atomic record change.** A release is one application commit
  and may carry several images (a golden-path service runs a frontend and a
  BFF). The platform workflow builds, signs and attests each; the image that owns
  the migrations carries the `migration-plan`, the others attest an empty one. One
  bump changes every digest of the record together or none. That makes the record
  change atomic; it does not stop an Argo rollout running old and new pods side by
  side, so the BFF must stay compatible with the previous frontend (expand-contract),
  which the application's own N-1 test checks.
- **Copy, then bump.** The step copies a candidate by digest with its
  signatures into the vps registry and verifies the copied digest with cosign.
  Only then does it open the bump pull request, so a merged bump is always
  deployable. The registry push transport is an open owner decision (ADR 0143);
  the recommended transport is a pinned `crane copy` through the ADR 0143
  tailnet forward.
- **The bump is a pull request from its own identity.** A new `kore-platform`
  GitHub App opens bump and revert pull requests with contents and
  pull_requests write on this repository only. It is not the judge App, whose
  approval must come from another identity (ADR 0122), and not the owner.
  Creating the App and its keys is the owner's.
- **The judge's checklist is deterministic, with no agent pane (proposed; an
  owner decision, since it revises ADR 0109, which defines the judge as an agent
  role that reviews and then merges).** A bump merges, with no ask of the owner,
  only when all hold: the diff touches only
  the digest and attestation references of one application record; the signer is
  in the trust list; the image signature and all three attestations verify for
  the digest; the attested repository equals the record's repository; the
  version is greater than the deployed one; the digest is not on the rejected
  list; it exists in the vps registry; every flag in the flags manifest is
  default off; the attested safety pattern is dark-launched, feature-flagged,
  expand-contract or no-behaviour-change. A failure leaves the pull request open
  with the failed item as a comment and in the owner digest. The body carries a
  generated `Safety pattern:` line: `dark-launched` for a bump and for a revert
  alike, because a cluster-facing `no-behaviour-change` has no flag and would need
  a live run before merge (AGENTS.md).
- **Dark deploy.** Argo CD syncs the merged record with automated sync and
  self-heal. A candidate arrives with every flag it introduces off, and the
  application reads a flag with no state as off.
- **A deploy that does not become healthy is reverted.** When the Argo
  Application is not Synced and Healthy within 15 minutes of the bump (a PreSync
  migration failed or the pods are not Ready), the platform opens a `git revert`
  pull request of the bump and the judge merges it. The digest goes on a rejected
  list in the record, written only by that revert, so it is never bumped again.
  The window may be raised per application, never lowered. The old pods served
  throughout, and migrations are never rolled back.
- **A revert is judged by what it returns to.** A revert pull request returns the
  record to a digest that already ran on vps and was verified, is not on the
  rejected list, and needs only that check and its signature, not a new eval run.
  There is no other bypass of the attestations and no break-glass signing: the
  emergency tools are a flag off and a revert, both through the judge.
- **One queue per application.** Bumps, flag state changes and reverts share it:
  a flag turned on waits while a bump is in flight or being watched, while a
  revert and a flag turned off go first, since those are the owner's two emergency
  tools (record 7).
- **Expand-contract, behind a flag.** A new `app-delivery` platform flag, off in
  every overlay, gates the path and turns on for vps only after a live run of
  one real application repository through every stage (ADR 0077). The expand
  step adds an optional per-service digest, attestation references and a rejected
  list to the record and lets the ApplicationSet use the record digest when it is
  present and the release lock's `templateImages` otherwise. The contract step
  removes the fallback after the soak.
- **Accepted limits in v1.** Delivery (bumps, flag changes and reverts) halts
  while `kore-agents` or GitHub is down, and running applications are
  unaffected because Argo CD keeps syncing the last merged state. There is no
  source mirror in v1 (record 12).

## Proof

- **The signer claim first, apart from any cluster.** A throwaway application
  repository under the existing organization calls the platform workflow pinned by
  SHA and pushes an image to GHCR; `cosign verify` with the exact reusable-workflow
  identity at that SHA must pass from the controller. The run also records the
  negative case: an unlisted workflow identity and an image the application built
  and signed itself are refused. The repository is deleted afterwards, and the
  outcome is recorded before any overlay trusts a SHA subject.
- **Local first, as a dark launch.** `app-delivery` is on only in local (ADR 0077),
  with the local key authority standing in for the keyless one (ADR 0028), the k3d
  push transport that exists, and a fixture application repository. That proves
  poll, verify, copy, bump, Argo deploy dark, the flag ConfigMap, the failed-deploy
  revert, and expand then contract. It does not exercise keyless admission: only
  the signer-claim run and the vps run prove that. Turning the flag on in local
  still needs its own recorded outcome and a flag activation.
- **The vps run.** One real application repository shows: a candidate signed and
  verified; the copy into the vps registry; a bump merged by the judge path; an Argo
  deploy dark with the PreSync hook run; a flag turned on through its state pull
  request and read by the pod within about 90 seconds, then turned off ahead of the
  queue; a forced failing migration reverted within 15 minutes with the digest on the
  rejected list; an expand and then a contract release; and a forged or unlisted
  attestation refused at admission. The outcome records the application, the digests
  and the chart lock, as an outcome record does for a platform flag.

## Consequences

- A bump never waits for a person, and a bad digest takes no application down.
- The delivery step is a new product domain in `tools/kore`, which reaches `gh`,
  cosign, crane, `kubectl` and the harness merge tool as commands through the
  injectable runner; `tools/kore` never imports from `tools/harness`.
- The record schema (service, suborg, hostnames, digest, flags, rejected list)
  is concept 6's; this ADR names only the fields delivery writes.
- v1 checks no API compatibility between applications: an API's contract tests
  belong to its application, and a cross-application compatibility eval is a later
  idea. Record 6's _versioned_ means the release version.
- The existing namespace form `<service>--<environment>` in the ApplicationSet
  conflicts with record 13 (a namespace per suborg, no environment in names);
  concept 6 settles it.
