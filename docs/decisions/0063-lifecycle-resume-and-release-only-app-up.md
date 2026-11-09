---
status: accepted
summary: kore app up deploys only a lock entry signed by release automation (a workflow at a version tag), source builds go through kore local up, and every up first clears failed or canceled Helm releases and verifies it, refusing to uninstall a release whose claim holds retained data.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0063: Release-only `app up` and verified cleanup before resume

Source: [`infra/plans/2-implementation.md` § Step 13](../../infra/plans/2-implementation.md#step-13-complete-lifecycle-orchestration)

Refines: [ADR 0005](0005-release-automation-signed-image-trust.md), [ADR 0015](0015-local-signed-image-delivery.md), [ADR 0059](0059-identity-policy-evidence.md), [ADR 0054](0054-application-admission-gate-closed-at-foundation.md)

## Context

`kore app up` read the committed lock, whose entry carries the local developer
key, and accepted any signer the lock listed. ADR 0005 allows only protected
release automation to produce deployable images; ADR 0015 keeps the local key
as a distinct identity. Separately, an interrupted run left Helm releases that
`helm upgrade --install` refuses ("no deployed releases", "another operation is
in progress"). Only platform components had a recovery, and it did not verify
itself.

## Decision

- `app up` without an image override loads a lock (the committed one, or
  `--image-lock <file>`, the lock attached to a release) and refuses, before any
  cluster call, an entry whose signer is not a release workflow at a version tag
  (`isReleaseAutomationSigner`, the shape the release workflow already checks).
  cosign then verifies that exact identity and issuer before Helm runs.
- The override is the source build `kore local up` hands over. It is accepted
  only on Minikube, signed by `local-kore-key`, with its public key; anywhere
  else it is refused. Local builds never alter the release lock (ADR 0015).
- Before installing, `app up` runs one recovery per release (`recoverRelease`,
  shared with platform components): a release that never deployed is uninstalled
  and must then be absent; a canceled `pending-upgrade` or `pending-rollback`
  returns to the last deployed revision and must then be deployed; a release
  that was ever deployed is never uninstalled. Only the application's two
  releases are examined, so healthy dependencies are not reinstalled.
- Attempt-owned resources are the Helm release and what it rendered. The
  namespace, the pull Secret, and a deployed resources release's claims are not.
  A never-deployed resources release is not uninstalled while retained data
  exists in the namespace; the error says how to export first.
- `app status` reports `deployed`: the digest the release carries, whether it
  matches the lock, the registry, the lock's signer and its kind, whether the
  namespace is enrolled in image admission, and the environment's inventory
  mode. It reads only user-supplied Helm values and one namespace label, never
  a Secret.

## Interaction with ADR 0059

The two checks are layered, and both must pass. This ADR decides what kind of
signer `app up` accepts (release automation, never the local key). ADR 0059
decides which identities an environment trusts: `verifyImage` refuses a signer
outside the environment's trusted subjects. A release-signed lock entry is
therefore deployable only where the environment trusts that exact subject; on
`local`, which trusts only `local-kore-key`, it is refused with the relock
remedy, and a managed environment must list the release subject in
`trust.subjects`.

## Consequences

`kore app up reference` on the committed lock now refuses and names
`kore local up`; managed use needs a release lock. The rollback path and Helm's
acceptance of the recovery are proven only live
(`npm run test:integration:lifecycle`). The signer shape is a pattern, not a
binding to this repository's identity; that binding stays with Step 7.
