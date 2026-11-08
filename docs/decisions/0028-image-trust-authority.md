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
- The release workflow that signs by digest is added in the release refinement below.

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
  deployed. The local `oci-registry` Service is pinned to `10.96.0.50` through
  the environment overlay (the one place the address is chosen), and the glob is
  `10.96.0.50:5000/**`. The environment declares the range as
  `cluster.serviceCidr` (`10.96.0.0/12`) and `kore cluster up` passes it to
  Minikube as `--service-cluster-ip-range`, so the pin no longer relies on
  Minikube's default. `kore validate` fails when the pin lies outside the range
  or the glob does not name exactly `<pin>:5000`.
- Self-healing: a Service's clusterIP is immutable and bootstrap skips deployed
  releases, so a profile created before the pin keeps a random address. During
  local bootstrap, when the live `oci-registry` Service differs from the pin,
  Kore deletes only that Service (`kubectl --context <ctx> -n kore-registry
delete service oci-registry`), logs the rewiring to stderr, and reconciles the
  release so Helm recreates it. The Deployment and PVC are untouched, so pushed
  images stay; running pods keep the address they pulled by, and later deploys
  read the live address. An absent or already-matching Service changes nothing.
- Nothing is enrolled; enforcement is still off.

> Refined by [ADR 0031](0031-registry-address-platform-variable.md): the registry address is now the environment's `registry.address`, derived into the Service pin and the `images` glob; overlays no longer repeat it.

## Refinement (2026-11-08): release workflow and exact identities

`.github/workflows/release.yaml` is the only keyless signer. It runs on push of a
`vX.Y.Z` tag, builds `apps/reference`, pushes it to `IMAGE` (one variable,
`ghcr.io/corekraft/kore/reference`, the managed-example target), then signs the
pushed **digest** with keyless Cosign and verifies it with
`--certificate-identity` set to the exact workflow-on-tag subject and
`--certificate-oidc-issuer` set to the GitHub issuer. It never uses regexp flags
or a tag-based reference. The workflow writes `images.lock.json` (same format as
`infra/catalog/images.lock.json`, signer = the identity) as a run artifact; a
reviewer copies the digest into the catalog lock and adds the tag's subject to the
environment's `trust.subjects` in the same reviewed change.

- Permissions: `contents: read` for the workflow; the single job adds
  `packages: write` (push to GHCR) and `id-token: write` (keyless). Actions are
  pinned by SHA; Cosign comes from the mise pin (3.1.4), not an installer action.
- Each accepted release tag is its own subject, e.g.
  `.../release.yaml@refs/tags/v0.1.0`. Validation still rejects regexps,
  wildcards, branches, pull requests, and other repositories; a test ties the
  committed subjects to the workflow's real identity format.
- **Tag protection is outside the repository.** A ruleset restricting creation,
  updates, and deletion of `v*` tags to maintainers must be configured in GitHub
  settings. Without it, anyone able to push a tag can obtain a trusted signature,
  so the exact-subject check is only as strong as that ruleset.
- Not covered: mirroring upstream platform images into the registry (remaining),
  and no tag has been pushed or workflow run yet.
