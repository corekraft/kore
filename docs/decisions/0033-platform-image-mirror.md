---
status: accepted
summary: The tag-gated release workflow gets a separate mirror job that copies each approved platform image (the digest-pinned seeds, the one owner) into ghcr.io/corekraft/kore/mirror by digest, verifies recorded upstream provenance, signs the mirrored digest keylessly, verifies it with the exact tag identity, and emits a versioned platform image lock; admission and workloads are unchanged.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0033: Platform image mirror

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md)

Refines: [ADR 0028](0028-image-trust-authority.md) (the same tag identity now also signs platform images), [ADR 0026](0026-seed-manifest.md) (seeds gain machine-readable provenance and double as the approved list).

## Context

Only the reference app image is built and signed by `release.yaml`. The managed
`kore-platform-images` policy admits internal signed digests, but no signed
internal copy of the platform images exists yet, so managed workloads cannot be
rolled to one. This step produces the copies and the lock; rolling workloads and
changing admission are the next item.

## Decision

- **The approved list is `infra/catalog/seeds.yaml`.** The digest-pinned images
  in `versions.images` are exactly the seeds, and seed validation already ties
  each to its catalog pin and component. No second pin list is created. Each seed's
  evidence gains `provenance`: `{signed: true, issuer, identity}` (exact
  keyless signer, no patterns) or `{signed: false}`. The prose `source` stays as
  the human record.
- **A new `mirror` job** in `release.yaml` with the same `ref_type == 'tag'`
  gate, no `needs`, and the same minimal permissions (`contents: read`,
  `packages: write`, `id-token: write`). It runs beside `release` so an upstream
  outage cannot block the reference image. `jq` reads `seeds.yaml` directly
  (JSON-compatible YAML), so the workflow builds no Kore code.
- **Per image:** `crane digest <ref@digest>` must equal the recorded digest;
  signed upstreams are checked with `cosign verify` using the recorded exact
  issuer and identity, unsigned ones are recorded as `unsigned-upstream`;
  `crane copy` writes `mirror/<catalogImage>:<release tag>`; the copy's digest
  must equal the upstream digest (a bit-identical copy, so the recorded digest
  survives); the job signs `mirror/<name>@<digest>` and verifies it with
  `--certificate-identity` set to this workflow at the exact tag.
- **Lock:** `platform-images.lock.json`, version 1, uploaded as an artifact
  beside the app lock: per image the upstream ref and digest, the mirrored
  `ref@digest`, the provenance result, and the signer. `kore`'s
  `platformImageLockErrors` validates a lock against the seeds (same images,
  equal digests, matching provenance, exact tag signer).
- **crane 0.22.1** is pinned in `.mise.toml` and `versions.yaml`.

## Rejected alternatives

- **A separate approved-image list** (new catalog file or workflow-embedded
  digests): a second owner of every pin.
- **`cosign copy`:** deprecated in Cosign 3, and it would copy upstream
  signatures, which the mirror does not vouch for.
- **Adding mirroring to the `release` job:** couples the app image to upstream
  availability and widens one job's blast radius.
- **Building the lock with a `kore` command in CI:** needs Node build in the
  signing job for no gain over `jq`.
- **Regexp identities for upstream:** weaker than the exact subject already recorded.

## Consequences

- The mirror's tag (`:vX.Y.Z`) is only a handle for copying; everything
  downstream uses the digest.
- Not exercised until a real tagged run: GHCR package linking/visibility for
  `mirror/*` packages, `crane` push auth, upstream registry availability, and
  the exact cosign output. The lock is not yet consumed by anything.
- Charts and `registry.address` are not changed; the next item rolls managed
  workloads to these digests.
