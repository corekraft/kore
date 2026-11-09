---
status: accepted
summary: The tag-gated release workflow gets a separate mirror job that copies each approved platform image (the digest-pinned seeds plus infra/catalog/approved-images.yaml, every other platform image pinned by digest through chart values) into ghcr.io/corekraft/kore/mirror by digest, verifies recorded upstream provenance, signs the mirrored digest keylessly, verifies it with the exact tag identity, and emits a versioned platform image lock; an opt-in check fails any rendered image that is not approved by digest; admission and workload references are unchanged.
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

## Refinement: every platform image is digest-pinned and approved

The first cut mirrored only the three seeds, because every other platform image
was tag-pinned through its chart. Rolling workloads to mirrored references needs
every image approved and pinned by digest first, so this refinement does that
and nothing more: workloads still pull from upstream, now by digest.

- **The approved list has two files.** `seeds.yaml` stays the bootstrap
  exception (images that run before the verifier can). The new
  `infra/catalog/approved-images.yaml` (schema `schemas/approved-images.schema.json`)
  lists every other platform image as `{image, name, component, evidence}`. The
  evidence has the seeds' shape, including `provenance`, minus the seed-only
  `reason`. `name` is the mirror path and is unique across both files. Together
  they are the one approved list; `approvedImageList` returns both.
- **Provenance is verified, not assumed.** Where upstream signs keylessly, the
  exact issuer and identity were found from the signature's certificate and then
  confirmed with `cosign verify --certificate-identity` (no regexps): CloudNativePG
  operator and PostgreSQL 18, External Secrets, the OpenTelemetry operator and
  both collector distributions, the Prometheus config reloader, and
  kube-state-metrics. Identity may now also be an exact email, because the
  kube-state-metrics signer is a Google service account. Everything else is
  `signed: false`: upstream publishes no signature, signs with a key (cert-manager;
  the model records keyless signers only), or has a signature whose log
  certificate does not verify (`curlimages/curl`).
- **Charts pin by digest through values.** Provider-neutral digests live in
  `infra/environments/common/values/` (listed in the component's catalog
  `values`), `infra/observability/*/values.yaml`, and the local charts. Charts
  with a `digest` or `sha` field use it; the rest take `tag@sha256:...` or, for
  Istio and ztunnel, a full image reference. `opa-envoy` moves from
  `versions.yaml` into the approved list and is pinned in its chart. The
  PostgreSQL composition picks its operand image from a digest table keyed by
  `compatibilityVersion`, so each supported major version is approved.
- **The mirror job reads both files** with `jq`, fails on a repeated name, and
  has a 60-minute timeout for the larger list. Lock validation
  (`platformImageLockErrors`) takes the combined list.
- **`test:upstream-charts` gains an opt-in check.** It renders every Helm and
  local-chart component with the arguments `kore` uses and collects each
  `image:` field, `--*-image=` argument, `*IMAGE*` environment value, and
  embedded JSON `"image"` value (Helm test hooks never run on install and are
  skipped). Each must carry a digest and match an approved repository and
  digest, so a chart bump that adds or moves an image fails until the list
  records it. An offline test also fails if an approved image's digest appears
  nowhere in the repository.

### Gaps, stated

- **Istio's `grpc-agent` injection template** hard-codes `busybox:1.28` and the
  chart has no value for it. No pod here selects that template, so it is
  excluded by name in the upstream check, which fails if the image stops
  rendering.
- **Crossplane Function packages are still tag-pinned.** `function-go-templating`
  and `function-auto-ready` (`infra/apis/crossplane-functions/functions.yaml`) are
  OCI packages Crossplane pulls, not Helm output, so the rendered-image check
  cannot see them. They are the next images to approve and pin.
- **Local `kore up` now pulls by digest.** Not run here (no cluster allowed); the
  first live bootstrap must confirm each digest pulls, especially the Gatekeeper
  hook Jobs and the Istio proxy.
- Upstream signatures verify at mirror time, so a key-signed upstream
  (cert-manager) is mirrored with the unsigned result and gains a verifiable
  signature only from this repository's signer.

## Refinement: each mirror package is created linked, then copied unchanged

The first tagged run (`v0.3.0`, run 42534467085) failed on its first push with
`DENIED: requested access to the resource is denied`. GHCR lets a repository's
`GITHUB_TOKEN` create only packages linked to that repository, and it links a
package from the `org.opencontainers.image.source` label or annotation of the
first image pushed into it. A bit-identical `crane copy` carries neither, so the
token cannot create `mirror/<name>`. The reference image failed the same way
until its Dockerfile gained the label (#30).

- **Seed the link, keep the copy.** Before copying an image,
  `.github/scripts/link-mirror-package.sh` checks `mirror/<name>:kore-link`. If
  the tag is absent it pushes a one-empty-layer image labelled
  `org.opencontainers.image.source=https://github.com/corekraft/kore` (plus a
  description saying it only links the package), which creates the package
  linked to this repository. A present tag is left alone, so reruns are
  idempotent. The upstream digest is then copied unchanged, so the
  copy-digest-equality rule above stands and the recorded digest survives.
- **The link image is not a platform image.** It is never signed, never verified
  against the tag identity, and never enters the lock (lock validation already
  rejects any entry outside the approved list). Admission never needs it.
- **Built in a throwaway registry.** `crane mutate` edits only a pushed image,
  and the first push must already carry the label, so the image is assembled in
  an in-memory `crane registry serve` and copied (digest preserved) into the
  package.

### Rejected: annotate the mirrored top level

`crane` 0.22.1 cannot do it. `crane mutate --annotation` fails on an index
("mutating annotations on an index is not yet supported"), `crane index append`
rebuilds child descriptors, and a Docker manifest list (the cert-manager images)
has no annotations field. The denied PUT was also by digest, which points at a
child manifest the annotation would not reach. Other tools would be unpinned.

### Unverified until a real tag run

That a seeded `kore-link` image makes GHCR create the package linked to the
repository (rather than only linking the tag), that the packages come up public
as the organization setting intends, and that later pushes into a linked package
by the same token succeed. Rehearsed locally only against a throwaway registry:
label present in the config, second run skips, copy digest equals upstream.
