---
status: accepted
summary: Locally, kore signs candidate images with a local Cosign key held as a cluster Secret and no Rekor entry, and deploys them by exact digest pulled into Minikube with imagePullPolicy Never.
date: 2026-09-30
last-verified: 2026-11-08
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
  as a Kubernetes Secret (`kore-system/kore-local-signing-key`), created with
  `cosign generate-key-pair k8s://kore-system/kore-local-signing-key` and used
  for signing through the same `k8s://` reference. The local signing config has
  no Rekor or TSA service, so verification uses the public key read from that
  Secret and ignores the transparency log.
- No private key is ever written to disk. Cosign resolves `k8s://` through the
  kubeconfig's current context, so `kore` pins the configured context by giving
  cosign a temporary `KUBECONFIG` made from `kubectl config view --minify
--context <configured>`. It is refused if it embeds credentials, and it is
  deleted after the call. Cosign honoring `KUBECONFIG` over the current context
  was confirmed against cosign 3.1.3 with a throwaway kubeconfig, not from
  documentation, which does not state it.
- A legacy key under `.kore/keys/local` is ignored; `kore` reports that it can
  be deleted and never deletes it.
- Before Helm runs, `kore` verifies the signature and pulls the exact
  digest-qualified reference into the Minikube node, then deploys with
  `imagePullPolicy: Never`.
- The local key is a distinct identity that managed environments never trust,
  and local builds never alter the release lock.

## Rejected: plaintext key on disk

The first implementation kept an unencrypted key pair (empty
`COSIGN_PASSWORD`) under gitignored `.kore/`. That leaves a long-lived signing
secret in plaintext outside the cluster that trusts it, against the rule that
secrets never touch disk in plaintext, and nothing ties its lifetime to the
cluster whose images it signs.

## Consequences

The key's lifetime equals the cluster's: `local down --prune` destroys it, and
the next `local up` generates a new key and re-signs every image. `local up`
and `local down --prune` therefore discard the local image lock and the
published public key, so a digest signed by a vanished key cannot block
re-signing. `local down` without prune keeps the cluster, key, and lock.

Local proves the digest and signature workflow, not the signing boundary.
Release automation authority, Sigstore admission, and seed closure remain open
in Steps 7 and 9.
