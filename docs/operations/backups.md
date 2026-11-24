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
- **vps:** a daily, age-encrypted, in-cluster dump to a typed target on the
  box's own disks until an off-host target exists. **Planned**; see
  [vps](#vps) below.

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

## vps

**Planned.** The vps environment will back up its retained data on a schedule
([ADR 0155](../decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md),
with the rebuild in [ADR 0156](../decisions/0156-the-box-is-rebuilt-from-git-ghcr-and-backups-under-a-recovery-hold.md)).
Nothing here is built yet, and both flags are off in every overlay.

- **What is backed up.** Each PostgreSQL database that opts in with `backup: true`
  on its entry in the app record, which requires `retentionPolicy: Retain`.
  Platform-owned databases are always backed up. The OpenBao Raft snapshot is
  backed up on its own daily job, and the stage ledger is copied daily, encrypted.
  Nothing else is: telemetry is lost on purpose, images come from GHCR, and
  cluster-generated keys are regenerated.
- **Schedule and objective.** One daily job, outside the Sunday reboot window.
  The recovery point is 24 hours. The newest 14 daily backups per database and per
  snapshot are kept, then aged out by retention.
- **Target.** A typed `backup.target` in the vps overlay, of kind `interim` or
  `off-host`. The interim target is a pinned SeaweedFS on the box's own disks, so
  it does not survive the loss of the box. Every report names it "mechanics proven,
  not off-host". The off-host target is an S3-compatible bucket outside the box's
  failure domain. The provider is not yet chosen, so no page names one.
- **Who holds what.** The box holds only public recipients and a write-only
  credential, so it can write backups and never read or delete them. Restore,
  decryption and deletion run only on the controller, which holds the read and
  prune credentials. Every real-data backup is also encrypted to a second recovery
  recipient, whose identity is in the [recovery kit](recovery-kit.md).
- **Freshness.** The job writes the newest success into a ConfigMap, and the
  `backups` row, the contract check, the destroy check and the rollout check read
  it without decrypting. A backup is restorable when its manifest matches the
  object in the target, it is under 24 hours old, and a restore drill has passed in
  the last 30 days. A stale or interim record never passes a gate.
- **Restore.** Only from the controller, with `kore data restore --environment vps --from <object>`
  (**planned**). It refuses a non-empty database without `--overwrite-data --yes`,
  and it refuses a major-version mismatch before it decrypts.
- **Status.** The `backups` row for vps (**planned**) is audit-only: it warns but
  does not close admission or change the exit status.
- **Manual copy.** `kore data export --environment <name>` stays a manual extra
  copy. It counts for no gate.
- **Whole-box loss.** See [rebuilding the box](rebuild-the-box.md) for the order of
  a rebuild, and [the recovery kit](recovery-kit.md) for what the owner holds.
  The rebuild is not the "recover without a hand" promise.
