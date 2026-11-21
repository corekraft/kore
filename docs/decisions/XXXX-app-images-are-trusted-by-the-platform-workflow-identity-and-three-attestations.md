---
status: proposed
summary: An application image deploys only when the platform workflow, pinned by commit SHA in the application's repository, signed it and its three attestations (eval result, flags, migration plan); admission trusts an exact list of those workflow identities, which revises ADR 0028's tag-only subjects, and the image is built to a private GHCR package and copied by digest into the cluster registry.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: App images are trusted by the platform workflow's identity and three attestations

Source: [#1485](https://github.com/corekraft/kore/issues/1485), decisions 12 and 14 of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478)

Refines: [ADR 0028](0028-image-trust-authority.md) (who may sign), [ADR 0044](0044-managed-platform-images-from-the-mirror.md) (the mirror mechanism)

## Context

Applications live in their own repositories and commit freely (record 11, 14).
The platform judges what reaches the cluster (record 12), so the signature
admission trusts cannot be one an application can produce on its own. ADR 0028
trusts one signer per environment: the `release.yaml` workflow of this
repository at an exact `refs/tags/vX.Y.Z` subject, and rejects a regular
expression, a wildcard, a branch ref and any other repository. Today the
`kore-image-policy` chart verifies a signature only; it checks no attestation.

The threat model for v1 is mistakes and agent error (a writer pane pushing to an
application repository), not a hostile tenant. The owner's aim is safe delivery.
Isolating a hostile tenant's build is parked as a later decision.

## Decision

- **One signer: the platform workflow.** A reusable workflow in this repository
  builds the application image, runs the deterministic evals and the harness
  rules, and signs keylessly. An application repository calls it pinned by the
  full commit SHA of a platform release and cannot change what it does: the
  workflow accepts no input that skips an eval.
- **Admission trusts an exact list of workflow identities.** The trust list holds
  one exact subject per accepted platform workflow release. Accepting a new one is
  a reviewed edit to the list, as ADR 0028 already says of a new tag; a wildcard,
  a regular expression and a branch ref stay refused. ADR 0028's subject form,
  `release.yaml@refs/tags/vX.Y.Z`, widens to also allow a reusable workflow
  subject whose ref is a 40-character commit SHA, and its refusal of other
  repositories no longer applies to the caller, only to the workflow's own
  repository, which stays this one.
- **Proof before reliance.** That the certificate subject carries the called
  workflow at `@<sha>`, and not the caller, is a claim to prove in a live run. No
  environment trusts a SHA subject until that run is recorded.
- **Three attestations, one signature each, by the same identity.**
  `eval-result` (each eval and harness rule, pass or fail), `flags-manifest` (the
  flags the release declares) and `migration-plan` (each migration classified
  expand or contract). Admission requires the image signature and all three
  present for the digest. The `kore-image-policy` chart gains attestation
  verification; until it does, the platform's bump step checks them with cosign
  and admission checks the signature alone.
- **Origin and copy.** The workflow pushes to a private GHCR package under the
  existing organization, so a signed digest outlives the box. The platform copies
  the image by digest, signatures included, into the in-cluster registry (the
  ADR 0044 mirror mechanism) before a candidate is deployable on vps. Needing a
  paid plan or a new account for the package is an owner decision.
- **Every candidate is built from main.** A push to an application's main branch
  builds, evaluates, signs and publishes a candidate; there is no human tag. The
  version is the application manifest's semver plus the commit SHA, and the evals
  refuse a version already published for a different digest.

## Consequences

- An application cannot deploy past the platform: no signature from the platform
  workflow, or a missing attestation, and admission refuses the pod.
- A hostile tenant could still alter its own test fixtures; v1 does not defend
  against that.
- ADR 0028's validator and `kore-image-policy` chart need the subject widening and
  attestation support, each behind a flag and a live run (ADR 0077).
- GHCR's copy answers the loss of signed digests with the box that the
  in-cluster registry alone would have.
- The push transport into the vps registry is still open (ADR 0143); the copy
  waits on it.
