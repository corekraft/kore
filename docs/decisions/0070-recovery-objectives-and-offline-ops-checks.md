---
status: accepted
summary: Recovery objectives for every stateful component live in infra/catalog/recovery.yaml and are checked offline, and `kore ops` adds read-only inventory, upgrade, and CRD checks; scheduled backups stay managed-only until a live restore proves them.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0070: Declare recovery objectives and check upgrades offline

Source: [`infra/plans/2-implementation.md` § Step 15](../../infra/plans/2-implementation.md#step-15-operational-hardening-and-release)

Refines: [ADR 0029](0029-local-export-and-restore.md) (scheduled backups and
object storage wait for the managed environment).

## Context

Step 15 asks for upgrade tests, backup schedules with recovery objectives, CRD
conversion and rollback validation, and an offline dependency inventory. The
repository had the export and restore path (ADR 0029) and CRD ownership checks
(ADR 0057), but no declared objective, no upgrade comparison, and no aggregate
pin check. A local backup target (MinIO, a snapshot CSI driver, the barman-cloud
plugin) would add runtime components that nothing here can prove without a
cluster, which AGENTS.md forbids merging unproven.

## Decision

- **Objectives are catalog data.** `infra/catalog/recovery.yaml` (schema in
  `schemas/recovery.schema.json`) lists, per kind of data: components,
  protection (`data-export`, `rebuild`, `scheduled-backup`), schedule, RPO, RTO,
  and a restore test. Validation requires an objective for every component
  whose values or sources declare a volume or retention label, and an
  `*.integration.spec.ts` restore test for every local export objective.
- **Local protection is the existing export.** There is no local scheduler, so
  the local schedule is "on demand, before destroy or upgrade", with a one-day
  RPO the operator keeps. Delete-class data is rebuilt, and says why.
- **Scheduled backups are managed-only and `planned`.** The managed objective
  is declared, not implemented. It becomes `active` only with a live restore
  test; no ScheduledBackup is added to the composition before then.
- **Offline checks sit behind `kore ops`** (read-only): `inventory` (exact
  versions, digests, lockfile integrity, commit-pinned Actions), `recovery`,
  `upgrade-check` (catalog at a release tag read with `git show` against this
  checkout: downgrades, skipped Kubernetes minors, removed CRD owners, breaking
  application contract changes), and `crd-check` (CRDs of each changed chart
  rendered at both versions with `helm template`: removed CRDs, dropped stored
  versions, unsafe storage moves, rollback that cannot read the new version).
- **Live proofs are opt-in.** `npm run test:integration:ops` runs the restore
  spec; `npm run test:upstream-charts` includes the CRD comparison.

## Consequences

- The recovery time objective is measured by the live spec, not assumed.
- Adding a stateful component fails validation until it declares an objective.
- CRD checks cover remote Helm charts; local charts and manifests are covered by
  the git diff and the application contract check.
- Not yet proven live: the restore spec and a live upgrade from the previous
  tag; neither was run (no cluster was touched).
