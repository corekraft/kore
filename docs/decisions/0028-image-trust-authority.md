---
status: accepted
summary: Each environment declares one validated image trust authority (exact GitHub Actions release identity, or the local key) and the kore-image-policy chart renders ClusterImagePolicy from it; no namespace is opted in yet.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0028: The image trust authority

Source: [`infra/plans/2-implementation.md` § Step 7](../../infra/plans/2-implementation.md)

Refines: [ADR 0015](0015-local-signed-image-delivery.md) (names who may sign), [ADR 0026](0026-seed-manifest.md) (seeds stay outside the policy).

## Context

Signed delivery needs a verifier that accepts exactly one signer per
environment. Kore's managed signer is a protected GitHub Actions release
workflow (keyless Cosign); local keeps its cluster-lifetime key.

## Decision

- **One owner:** the `kore-image-policy` environment values overlay holds
  `trust`; the local chart `infra/charts/image-policy` renders a single
  `ClusterImagePolicy` (`kore-platform-images`, v1beta1) from it.
- **Keyless** requires issuer `https://token.actions.githubusercontent.com` and
  one or more **exact** subjects of the form
  `https://github.com/corekraft/kore/.github/workflows/<file>.yaml@refs/tags/vX.Y.Z`.
  `subjectRegExp`/`issuerRegExp`, wildcards, branch and pull-request refs, and
  other repositories fail `kore validate`. Accepting a new release tag is a
  reviewed change to the subject list, not a wildcard.
- **Key** (local) names the public-key Secret by `keyRef`; it cannot be combined
  with keyless fields. A missing authority fails validation.
- **Scope:** `images` globs name the internal registry host literally. A glob
  that is too broad or covers a seed image (ADR 0026) is rejected, so seeds are
  never matched; once enforced, a seed in an opted-in namespace is rejected as
  unmatched until it is rolled to a signed internal digest.
- **Fail closed:** the policy matches `pods`, so containers, init containers,
  and ephemeral containers are all evaluated; the Policy Controller rejects
  images matching no policy, and its webhook uses `failurePolicy: Fail`.
- **Audit before enforce:** the Policy Controller evaluates only namespaces with
  the include label, and nothing labels one. Enrollment is a later step.

## Consequences

- Enforcement is not active; enrolling namespaces is the next step.
- The local registry host and the public-key Secret location are open
  (see the plan notes): the controller reads key Secrets from `cosign-system`.
- The release workflow that signs by digest does not exist yet.
