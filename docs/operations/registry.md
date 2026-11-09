# Registry: Backup, Restore, Garbage Collection, and Signatures

Operational facts about the internal registry (`oci-registry`, namespace
`kore-registry`; [ADR 0034](../decisions/0034-registry-authentication-and-authorization.md),
[ADR 0058](../decisions/0058-registry-transport-tls.md)). Commands are written
as `kore ...`; see the [operator guide](../guides/operator.md) for how to run
them.

## What the registry holds

The image store is a 10Gi claim on `kore-standard` labelled
`platform.kore.dev/retention=Delete`. It is **rebuildable cache**, not a source
of truth: the source is the repository (application Dockerfiles, the release
image lock, and the platform image lock) and the signing key's lifetime equals
the cluster's ([ADR 0015](../decisions/0015-local-signed-image-delivery.md)).
`cluster destroy` never treats it as retained data.

## Backup

There is none, by design, for the local profile.

**Gap:** no `kore` command backs up or restores the registry store, and no
schedule exists. Recovery is a rebuild (below). A managed registry's backup,
replication, and retention belong to its provider (plan: Managed cluster).

## Restore and disaster recovery

| Loss                           | Recovery                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Registry pod or its claim      | `kore platform up --environment local` recreates the release; `kore local up` rebuilds, republishes, re-signs, and redeploys.    |
| The whole profile              | `kore local up --environment local` on a fresh profile; restore retained data afterwards with `kore data restore`.               |
| Registry credentials leaked    | `kore registry rotate-credentials --environment local --yes` ([ADR 0055](../decisions/0055-registry-credential-rotation.md)).    |
| Registry certificate or CA     | See [trust roots and rotation](trust-and-rotation.md#registry-certificate-and-ca).                                               |
| Signing key lost with the node | The key is a cluster Secret; a fresh `kore local up` generates a new one and re-signs every image. No old signature is reusable. |

Recovery objective for the local profile: **RPO** is "the last git commit" for
images (nothing in the store is unique) and "the last `kore data export`" for
databases; **RTO** is one `kore local up` (minutes, dominated by image builds
and controller rollouts). These are expectations for a developer machine, not
tested objectives.
**Gap:** no restore test measures them (plan Step 15, "Add backup schedules,
restore tests, and recovery objectives").

## Data export and restore

Retained databases are the only data worth backing up. `kore data export
--environment local` writes an age-encrypted, digest-manifested dump to the
ignored `.kore/exports/<environment>/`; `kore data restore --environment local
--from <file> --identity <age key>` loads it into a fresh profile and refuses a
database that already holds tables unless `--overwrite-data --yes` is given
([ADR 0029](../decisions/0029-local-export-and-restore.md)).
**Gap:** no schedule runs exports; they are manual. Keep the age identity off
the machine that holds the exports.

## Garbage collection

**Gap:** the registry does not enable storage deletion
(`REGISTRY_STORAGE_DELETE_ENABLED` is not set in
[`infra/charts/oci-registry/templates/all.yaml`](../../infra/charts/oci-registry/templates/all.yaml)),
so manifests cannot be deleted through the API and `registry garbage-collect`
would free nothing. No `kore` command does garbage collection. The supported way
to reclaim space is to recreate the registry claim or the profile and republish
(`kore local up`). Watch the claim with `kubectl --context kore-local --namespace
kore-registry get pvc`; `kore platform status` does not report its usage.

## Signature retention

- A signature is a `sha256-<digest>.sig` tag in the same repository as the image.
  It lives and dies with the store: there is no separate signature store.
- Local signatures carry no Rekor entry, so there is no transparency log to
  retain or search ([ADR 0015](../decisions/0015-local-signed-image-delivery.md)).
- Release signatures (keyless) are recorded by Sigstore's public log; the
  accepted identity is pinned in the environment overlay
  ([signing and keys](signing-and-keys.md)).

## Immutable tags and the digest policy

- **Deployment is by digest only.** `kore app up` deploys the exact digest it
  verified; a tag is never resolved at deploy time, and `kore validate` rejects
  an unpinned platform image. The `image-inventory` row in `kore platform
status` classifies every running image (internal digest, approved upstream
  digest, seed, tag-only, unknown) and `imageInventory` in the overlay chooses
  `audit` or `enforce` ([ADR 0056](../decisions/0056-platform-image-inventory.md)).
- Retagging an image cannot change what runs, because the policy matches the
  signed digest. **Gap:** the registry proxy does not forbid overwriting a tag
  (only `kore-push` may write, and Kore is its only writer); registry-level tag
  immutability is not configured.
- The local release lock `infra/catalog/images.lock.json` is edited only from a
  release's `images.lock.json`; local builds never touch it.
