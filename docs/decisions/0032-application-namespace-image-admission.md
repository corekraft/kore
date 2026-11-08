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
