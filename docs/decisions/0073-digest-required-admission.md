---
status: accepted
summary: A dryrun Gatekeeper constraint requires every container and initContainer image outside third-party namespaces to be pinned by @sha256 digest, because Policy Controller resolves tag-only references instead of refusing them; the live reference smoke spec reads its API token from the cluster Secret, not .kore/.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0073: Require digest-pinned images and read the smoke token from the cluster

Source: [`infra/plans/2-implementation.md` § Step 12](../../infra/plans/2-implementation.md) (image-admission tests: tag-only)

Refines: [ADR 0028](0028-image-trust-authority.md) (image trust authority).

## Context

PR #92 left one question open: does Sigstore Policy Controller admit a
tag-only image reference? At the pinned v0.13.1 (`infra/catalog/versions.yaml`),
`pkg/webhook/validator.go` (`resolvePodSpec`) resolves a tag to a digest when it
runs as the mutating webhook and rewrites the image to `repo:tag@sha256:...`;
the signature is then verified against the resolved digest. So a tag-only
reference in an enrolled namespace is admitted when the image it currently
points at is signed. That is trust in a mutable tag at admission time, which
the platform rule ("deploy what was verified, by signed digest, never by tag")
does not allow.

Separately, the opt-in reference smoke spec read the API token from
`.kore/state/reference-api-token`. Specs should not depend on the layout of
private local state.

## Decision

1. `KoreImageDigest` / `kore-image-digest` (new template and constraint, in
   `dryrun` per audit-before-enforce) rejects any container or initContainer
   whose image does not end in `@sha256:<64 hex>`. It matches Pods and
   Deployment, StatefulSet, DaemonSet, Job, and CronJob, and exempts the same
   third-party controller namespaces as `kore-container-security`.
2. The smoke spec obtains the token through `readReferenceApiToken`, one
   `kubectl get secret/reference-app --output=jsonpath={.data.API_TOKEN}` that
   decodes in memory. It never reads `.kore/`, writes a file, or puts the value
   in a message.

## Consequences

- Ordering caveat: Gatekeeper validates after mutating webhooks. In a namespace
  where Policy Controller mutates, a tag-only workload is already rewritten to
  `tag@digest` when Gatekeeper sees it, so the constraint passes it. The
  constraint therefore guards unenrolled paths and records what is deployed; the
  platform's actual guarantee remains that `kore app up` deploys only the
  lock's digest (`release.ts`). Whether the mutation reaches the object
  Gatekeeper reviews is a live question and unproven here.
- What it would deny on the current tree: nothing in `kore-system`, the
  reference app (rendered with `image.digest`, asserted by
  `app/reference-negative.spec.ts`), or other app namespaces. Platform
  namespaces not in the exempt list (`kore-system`, `kore-registry`,
  `opa-system`, `cosign-system`) may report violations from seed or chart
  tag references until Step 7 rolls them to locked digests; the dryrun audit
  shows which.
- Promotion evidence: zero violations in a recorded audit across a full
  `kore local up` and `kore app up reference`, per `policy-promotion`.
- Nothing here ran live.
