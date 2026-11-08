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
- The local registry host and the public-key Secret location were open here and
  are settled in the refinement below.
- The release workflow that signs by digest does not exist yet.

## Refinement (2026-11-08): local public key and registry host

A fresh `local up` failed: Policy Controller rejects `secretRef.namespace` outside
its own namespace (`cosign-system`), and reads a key Secret that must hold exactly
one data entry, while `kore-system/kore-local-signing-key` also holds the private
key and password. Decisions:

- The local signer server-side applies a public-key-only Secret
  `cosign-system/kore-local-signing-pub` (single entry `cosign.pub`, field manager
  `kore-signing`, labelled `app.kubernetes.io/managed-by: kore-signing`), streamed
  through kubectl stdin. The private key is never copied and the policy never
  references the original Secret.
- `platformUp` ensures the key pair and this Secret right after Policy Controller
  and local trust are ready, before the configuration phase, so
  `kore-image-policy` (whose readiness waits only on the `ClusterImagePolicy`
  object) never references a missing Secret.
- `kore validate` rejects a `keyRef.namespace` other than the `policy-controller`
  component's namespace.
- Registry host: node container runtimes pull and cache by ClusterIP because they
  cannot resolve cluster DNS, so the DNS name in the glob never matched what is
  deployed. The local `oci-registry` Service is pinned to `10.96.0.50` (inside
  Minikube's default service range, in the lower band Kubernetes keeps for static
  assignment) through the environment overlay, and the glob is
  `10.96.0.50:5000/**`. A different service CIDR needs both values changed.
- Nothing is enrolled; enforcement is still off.
