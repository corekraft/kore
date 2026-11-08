---
status: accepted
summary: Locally, kore signs candidate images with a local Cosign key and no Rekor entry, and deploys them by exact digest pulled into Minikube with imagePullPolicy Never.
date: 2026-09-30
last-verified: 2026-11-07
---

# ADR 0015: Deliver locally signed images by digest into Minikube

Source: [`infra/plans/2-implementation.md` § Progress Record](../../infra/plans/2-implementation.md#progress-record)
(Steps 7 and 12)

Refines: [ADR 0005](0005-release-automation-signed-image-trust.md)

## Context

The local cluster has no protected release automation and no public
transparency log, and its node runtime cannot use the in-cluster registry
through its normal pull path. Local still has to exercise the signed-digest
flow.

## Decision

- `kore` builds the candidate, pushes it to the in-cluster registry, reads the
  manifest digest, and signs that digest with a local Cosign key pair kept
  under `.kore/keys/local`. The local signing config has no Rekor or TSA
  service, so verification uses the local public key and ignores the
  transparency log.
- Before Helm runs, `kore` verifies the signature and pulls the exact
  digest-qualified reference into the Minikube node, then deploys with
  `imagePullPolicy: Never`.
- The local key is a distinct identity that managed environments never trust,
  and local builds never alter the release lock.

## Consequences

Local proves the digest and signature workflow, not the signing boundary.
Release automation authority, Sigstore admission, and seed closure remain open
in Steps 7 and 9.
