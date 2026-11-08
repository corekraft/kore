---
status: accepted
summary: infra/catalog/seeds.yaml records every digest-pinned seed artifact with its reason and upstream evidence, and kore validate rejects any seed-component image it does not record.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0026: The seed manifest

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md)

Refines: [ADR 0015](0015-local-signed-image-delivery.md) (signed delivery cannot cover the images that start the registry and verifier).

## Context

The internal registry and the Sigstore Policy Controller must run before any
image can be served from the registry or verified by the controller. Their
images are therefore admitted on upstream trust. Later steps roll them to signed
internal digests and require the seed set to be empty before bootstrap succeeds,
which needs a closed, auditable list first.

## Decision

- **A seed is an image admitted before the registry and verifier exist,** used
  by a component that is itself part of starting them. Only the registry image,
  the Policy Controller webhook image, and the Policy Controller lease-cleanup
  image qualify. Their only catalog dependency, the Gateway API manifest, ships
  CRDs and no images.
- **`infra/catalog/seeds.yaml` is the single owner.** Each entry names the image
  (`tag@sha256`), its `versions.images` key, the consuming component, why it must
  be a seed, and upstream evidence (method, source, date checked). Evidence is a
  keyless Cosign identity where upstream signs, else the upstream digest source.
- **`kore validate` rejects:** a seed without a digest, reason, or evidence; an
  unknown component; a seed that differs from the catalog pin or is not used by
  its component; and any catalog image configured in a seed component's values
  that the manifest does not record. Validation reads files only.
- **Everything else is not a seed.** Controllers installed after the registry and
  verifier (cert-manager, Istio, Crossplane, and so on) are delivered through the
  signed path, so they are never exempt.

## Consequences

- Adding an image to a seed component fails validation until it is recorded.
- Upgrading a seed pin means updating the catalog and seeds together.
- Rolling seeds to signed internal digests and emptying the manifest remain later
  work; this ADR enables no enforcement.
