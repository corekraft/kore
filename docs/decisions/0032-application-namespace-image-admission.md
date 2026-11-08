---
status: accepted
summary: kore app up enrolls every application namespace in Sigstore admission (mandatory, read back), policies carry a per-environment warn/enforce mode that starts at warn, and Kore-placed upstream images (Istio waypoint, CloudNativePG) get a separate static-pass policy so internal images keep requiring signatures.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0032: Application namespace image admission

Source: [`infra/plans/2-implementation.md` § Step 9](../../infra/plans/2-implementation.md)

Refines: [ADR 0028](0028-image-trust-authority.md) (replaces "no namespace is opted in yet"), [ADR 0025](0025-application-namespace-ambient-enrollment.md) (same owner, second label).

## Context

Policy Controller evaluates only namespaces labelled
`policy.sigstore.dev/include: "true"`, and in those namespaces rejects any image
no `ClusterImagePolicy` matches. The no-match behavior (`no-match-policy`) is
one cluster-wide setting, not per policy. An application namespace also holds
images Kore did not build: the Istio waypoint proxy (`docker.io/istio/proxyv2`)
and the CloudNativePG instance image (`ghcr.io/cloudnative-pg/postgresql`).
Once enforced, these would be rejected as unmatched.

## Decision

- **Mandatory enrollment:** `kore app up` (`enrollNamespace`) applies the
  include label together with the mesh label, then reads it back from the
  configured context and refuses the release if it is absent. There is no flag
  to skip it.
- **Audit before enforce:** `trust.mode: warn | enforce` is schema-validated per
  environment and rendered into `spec.mode` of every policy in the chart. Local
  and managed-example start at `warn`. Moving to `enforce` is a reviewed overlay
  change after a clean warn period.
- **Upstream images get their own policy**, `kore-upstream-images`, with a
  `static: action: pass` authority and exact repository globs owned by the chart
  (`upstreamImages`). `kore-platform-images` keeps the registry-address glob and
  the signature authority and never gains a static pass. Alternatives rejected:
  setting `no-match-policy: allow` (weakens every unmatched image), moving
  databases to a second, unenrolled namespace (splits one application's
  resources and the Gatekeeper/mesh contracts), and signature-verifying
  upstream images (the Istio proxy image is unsigned).

## Consequences

- A static pass trusts a repository, not a digest or signer, for the two
  upstream repositories. The CloudNativePG image is only tag-pinned. Tightening
  to digest-pinned and, where upstream signs (CloudNativePG does), keyless
  verification is a later step.
- Another upstream image placed into an application namespace requires a
  reviewed edit to `upstreamImages`.
- Registry membership still grants nothing: internal images need the signature.
- Live verification of glob matching (`index.docker.io` normalization, tag and
  digest suffix) happens in warn mode before enforcing.

## Refinement: live warn-mode trial (2026-11-08)

A warn-mode trial on the local profile found three defects. Each cause below is
from upstream source at the pinned versions (policy-controller v0.13.1, built on
cosign v2.5.0 and go-containerregistry v0.20.3; cosign CLI 3.1.4), not from
behavior alone.

**1. "no signatures found" for kore-signed images.** cosign 3 signs in the
Sigstore bundle format by default and stores it as an OCI referrer. Policy
Controller 0.13.1 only reads a bundle for keyless authorities
(`checkOptsFromAuthority`: "when using the new bundle format, the authority must
be keyless"; `signatureFormat: bundle` is the opt-in), so a key authority looks
for the legacy `sha256-<digest>.sig` tag and finds none. Not the cause, checked
and ruled out:

- **Transparency log:** with no `ctlog` and no Rekor keys on the authority the
  verifier sets `IgnoreTlog`, so a key authority needs no tlog entry and no extra
  option.
- **Plain HTTP:** go-containerregistry's `Registry.Scheme()` selects HTTP for
  RFC 1918 addresses (and loopback and `*.local`) and the transport pings HTTPS
  then HTTP, so the `10.x` ClusterIP registry needs no insecure option. This holds
  only for such addresses: an external registry reached by a public hostname must
  serve TLS, and there is no Policy Controller setting that relaxes that (do not
  add one cluster-wide).

_Decision:_ kore signs local images with `--new-bundle-format=false
--use-signing-config=false --tlog-upload=false` (plus the existing
`--allow-http-registry`, for the CLI only). cosign 3.1.4 rejects a signing config
combined with the legacy format, so the local signing config and its generation
step are removed. `cosign verify` in 3.1.4 detects the missing bundle and falls
back to legacy signatures, so kore's own verify is unchanged. These flags are
deprecated in cosign 3; when Policy Controller reads key bundles
(`signatureFormat: bundle` for key authorities) switch back and drop them. Images
signed before this change carry only a bundle and must be re-signed by `kore
local up`. The managed (keyless) path is unaffected: it will use
`signatureFormat: bundle`.

**2. Opting in already enforced for unmatched images.** `no-match-policy` is a
cluster-wide key of `config-policy-controller`; the chart ships only `_example`,
and the default is `deny`, regardless of any policy's `spec.mode`. The chart
sets it through `webhook.configData`. kore now passes
`webhook.configData.no-match-policy` to the `policy-controller` release, derived
from the same `trust.mode` as the policies: `warn` for `warn`, `deny` for
`enforce`, and `deny` for anything else (fail closed). There is one source of
truth and no values-file copy.

**3. "no matching policies" for Deployments and the migration Job.** Both
policies carried `match: pods`. The webhook evaluates each pod-template kind
under its own kind (`GetMatchingPolicies` maps kind to resource), so a Pod
matched (hence the later `--dry-run=server` pod) while the Deployment and Job
did not and fell to the `deny` default. The `match` is removed so the policies
apply to every kind the webhook evaluates. A second, unproven contributor is
policy propagation lag: the controller writes policies into its ConfigMap
asynchronously. Readiness now waits for both policies rather than only
`kore-platform-images`; a longer wait is not added until a live run shows lag.

_Live re-verification (orchestrator):_ re-sign, then confirm a
`--dry-run=server` Deployment and Job of the internal digest pass with no
warning, an unsigned internal digest warns, and an unmatched image
(`busybox:1.37`) warns rather than denies while `trust.mode` is `warn`.

## Refinement: promotion of local to enforce (2026-11-08)

Audit before enforce: the live warn-mode run was clean. `busybox:1.37.0` was
admitted only with a "no matching policies" warning, and the re-signed internal
image and the upstream static-pass images were admitted with no warning. Local
`trust.mode` is now `enforce`: both policies render `spec.mode: enforce` and
`no-match-policy` becomes `deny`. `managed-example` stays at `warn`.

Before flipping, every image that can run in an enrolled application namespace
(`reference`) was listed and matched against the policies. Ambient mode injects
no sidecars.

| Image                                                                   | Matched by                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------- |
| Workload Deployment and migration Job (`10.96.0.50:5000/reference@…`)   | `kore-platform-images` (signature required)         |
| Istio waypoint (`docker.io/istio/proxyv2`)                              | `kore-upstream-images`                              |
| CloudNativePG PostgreSQL instance (`ghcr.io/cloudnative-pg/postgresql`) | `kore-upstream-images`                              |
| CloudNativePG operator image (`ghcr.io/cloudnative-pg/cloudnative-pg`)  | none before this change; now `kore-upstream-images` |

**Gap found and closed.** CloudNativePG runs its `bootstrap-controller` init
container from the operator image in every instance and initdb pod; live,
`reference-db-1` carries `ghcr.io/cloudnative-pg/cloudnative-pg:1.30.1`. Under
`deny` that pod would have been rejected. `upstreamImages` gains
`ghcr.io/cloudnative-pg/cloudnative-pg**`, a repository-level static pass like
the other two. A test renders the pinned chart (0.29.1) and requires the
`OPERATOR_IMAGE_NAME` repository to appear in the policy, so a chart bump that
moves the repository fails instead of denying the database at runtime. The
operator image is tag-pinned by the chart, not digest-pinned; the tightening
noted under Consequences covers it too.
