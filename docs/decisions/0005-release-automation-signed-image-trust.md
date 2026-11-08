---
status: accepted
summary: Workloads run only from internal, digest-qualified images signed by protected release automation, verified at admission by Sigstore Policy Controller, with a closed bootstrap seed loop.
date: 2026-09-12
last-verified: 2026-11-07
---

# ADR 0005: Trust images by release-automation signature, not by registry

Source: [`infra/plans/1-initialize.md` § Image Provenance and Registry Trust](../../infra/plans/1-initialize.md#image-provenance-and-registry-trust)

## Context

A registry path or mutable tag says nothing about who produced an image.
Developers and ordinary CI jobs can push images, so trust has to come from a
signature that only protected automation can make. The registry and the
signature verifier are themselves images, which creates a bootstrap loop.

## Decision

- The platform runs an OCI Distribution-compatible registry as foundational
  infrastructure. Workloads consume images from it by immutable digest.
- Only protected release automation may sign. Verification is bound to an exact
  workload identity (OIDC issuer and protected workflow subject) or to a
  KMS/HSM key that only that identity can use. Developers, pull-request
  workflows, ordinary build jobs, cluster workloads, and registry
  administrators get no sign permission.
- Build automation may push candidates to staging. Release automation verifies
  the candidate and its checks, promotes, signs, verifies, and emits the
  digest-qualified reference.
- Sigstore Policy Controller verifies signatures at admission for containers,
  init containers, and ephemeral containers, and fails closed on any error.
  Gatekeeper does not duplicate signature verification in Rego.
- Bootstrap starts from a minimal, repository-recorded set of digest-pinned
  seed artifacts, then mirrors, verifies, signs, and rolls every platform
  workload to internal digests. Bootstrap fails while any seed, external,
  tag-only, unsigned, or unauthorized image remains.
- Signing credentials never live in the registry, cluster, repository, Helm
  values, or developer workstations.
- Local development runs the same flow with a distinct local identity that
  managed environments never trust.

## Consequences

A managed environment can substitute a provider registry without changing
charts. Local proves workflow behavior but not the developer/signing boundary,
which only managed KMS/IAM and protected CI provide. The local flow is refined
by [ADR 0015](0015-local-signed-image-delivery.md).
