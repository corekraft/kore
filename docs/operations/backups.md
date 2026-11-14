# Backups and Recovery Point Objective

How retained data is protected and how Kore tells you when the protection is stale
([ADR 0074](../decisions/0074-backup-freshness-row.md),
[ADR 0029](../decisions/0029-local-export-and-restore.md),
[ADR 0070](../decisions/0070-recovery-objectives-and-offline-ops-checks.md)).

## Target

- **Local:** `kore data export --environment local` writes an age-encrypted
  `pg_dump` of each retained CloudNativePG cluster plus a digest manifest to
  `.kore/exports/local/` on the host. It survives `cluster destroy` and
  `kore local down --prune`, which an in-cluster backup would not.
- **Managed:** provider object storage. **Not yet implemented**; the managed
  objective in `infra/catalog/recovery.yaml` is `planned` until a live restore
  proves it (Step 7).

## Objective

There is no scheduler. The schedule is the recovery point objective declared in
[`infra/catalog/recovery.yaml`](../../infra/catalog/recovery.yaml)
(`retained-postgresql`: RPO 1440 minutes, RTO 15 minutes), validated by
`kore ops recovery`. The operator keeps it by exporting before destroy, before an
upgrade, and at least daily while retained data exists.

## Checking it

`kore platform status --environment local` includes a `backups` row:

| State      | Meaning                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ready`    | No retained data exists, or the newest verified export is younger than the RPO.                                                                                    |
| `degraded` | Retained data exists and the newest export is older than the RPO, or there is none. The detail names the age, the RPO, and `kore data export --environment local`. |
| `missing`  | The cluster could not be read, so retained data could not be listed.                                                                                               |

The row reads export manifest metadata and `kubectl get` only; it never decrypts
and never touches key material. It is audit-only: a degraded `backups` row does
not close the admission gate, does not fail `kore platform up`, and does not
change the `kore platform status` exit code.

## Restore

Restore into a fresh profile with `kore data restore --from <artifact> --environment local`,
as described in [registry recovery](registry.md#restore-and-disaster-recovery)
and ADR 0029. The restore time objective is measured by the opt-in spec
`npm run test:live:ops`, not assumed.
