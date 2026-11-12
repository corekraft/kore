# Signing Identity, Key Rotation, and Compromise Response

Who may sign, how that authority changes, and what to do when it is
compromised. The design is in
[ADR 0028](../decisions/0028-image-trust-authority.md); the controls that bind
the release signer to one protected workflow are in
[`docs/release-signer-controls.md`](../release-signer-controls.md). Commands are
written as `kore ...` (see the [operator guide](../guides/operator.md)).

## The two authorities

| Environment       | Signer                                                                                                                                | Where it is declared                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `local`           | A Cosign key pair held as the `kore-system/kore-local-signing-key` Secret; the public half is `cosign-system/kore-local-signing-pub`. | `trust` in [`infra/environments/local/values/image-policy.yaml`](../../infra/environments/local/values/image-policy.yaml) |
| `managed-example` | Keyless: the exact `release.yaml@refs/tags/vX.Y.Z` GitHub Actions identity.                                                           | `trust` in the environment's `image-policy` values                                                                        |

`kore validate --environment <name>` rejects regexps, wildcards, branch and
pull-request refs, other workflows, and other repositories.

## Local key rotation

The local key lives as long as the cluster. To rotate it:

1. `kore local down --environment local --prune` (add `--purge-data` only after a
   verified `kore data export`). This destroys the cluster and the key.
2. `kore local up --environment local` generates a new key, publishes its public
   half, and re-signs and redeploys every image.

**Gap:** there is no in-place local key rotation that keeps the cluster (plan
Step 15, "Document signing identity and key rotation, revocation, compromise
response"; Step 7 holds the protected-signer work). A fresh
key requires a fresh profile (or deleting the two Secrets by hand and rerunning
`kore local up`, which is not a tested path).

## Release identity rotation (accepting a new tag)

Trust moves by a reviewed change, never by a wildcard:

1. Cut the tag (release-please; [README](../../README.md#releases)). The
   workflow signs the digest and attaches `images.lock.json` and
   `platform-images.lock.json`.
2. Copy the digest into `infra/catalog/images.lock.json` and add the tag's
   subject to the managed environment's `trust.subjects` in a pull request.
3. `kore validate --environment managed-example --platform-image-lock <file>`
   checks the lock against the overlay and the image policy.
4. Merge, then reconcile the managed cluster (`kore platform up`). Keep the old
   subject until every workload runs a digest signed by the new one, then remove
   it.

**Revocation is removal.** Deleting a subject from `trust.subjects` stops that
identity admitting new pods; running pods are not evicted.

## Compromise response

Signing key or release identity suspected compromised:

1. **Stop trusting it.** Remove the subject (or, locally, destroy the profile:
   `kore local down --environment local --prune`). Restrict who can push tags
   with the `v*` ruleset ([checks](../release-signer-controls.md#manual-github-settings)).
2. **Find what it signed.** `kore platform status --environment <name>` lists
   every running image in `image-inventory`; compare digests with
   `infra/catalog/images.lock.json`. `kore journal --environment <name>` shows
   what Kore deployed and when. **Gap:** there is no `kore` command that lists
   every signature a given identity produced; use Cosign and the public log.
3. **Redeploy from a clean identity.** Rotate as above, then roll workloads to
   digests signed by it.
4. **Rotate dependent secrets.** Registry credentials
   (`kore registry rotate-credentials --environment <name> --yes`) and any
   secret the compromised workflow could read; see
   [trust roots and rotation](trust-and-rotation.md).

## Protected-pipeline controls

Enforced in the repository: one signing workflow, tag-only signing, read-only
tokens elsewhere (`hook workflow-permissions` (`tools/harness/src/hook/workflow-permissions.spec.ts`), run by
`mise run test-hooks`). Verified by hand against GitHub: tag ruleset, default
token permissions, fork approval, collaborators, GHCR access (the checklist in
the signer controls page). **Gap:** the real release identity is not yet bound
live on a cluster (plan Step 7), and no KMS key is configured.

## Break-glass recovery

**Gap:** there is no time-bounded, audited break-glass mechanism. Policy
Controller's `warn` mode (`trust.mode: warn` in the overlay) admits unsigned
images with a warning and is the only lever; changing it is a reviewed overlay
change and `kore platform up`, recorded in `kore journal`, and it must be
reverted in a follow-up change. Do not use `kubectl` to remove the
`policy.sigstore.dev/include` label or the webhook: that change is not in the
repository and not in the journal.
