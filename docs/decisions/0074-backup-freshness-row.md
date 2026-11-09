---
status: accepted
summary: Retained-data backups are the host-side encrypted export; the schedule is the RPO in recovery.yaml, and an audit-only `backups` row in `kore platform status` reports an export older than the RPO without gating admission or platform up.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0074: Report backup freshness against the recovery point objective

Source: [`infra/plans/2-implementation.md` § Step 15](../../infra/plans/2-implementation.md#step-15-operational-hardening-and-release)

Refines: [ADR 0070](0070-recovery-objectives-and-offline-ops-checks.md) (the
declared objective now has a runtime check) and
[ADR 0029](0029-local-export-and-restore.md) (the export is the local backup).

## Context

ADR 0070 declared a one-day RPO for retained PostgreSQL data and left the
local schedule "on demand". Nothing told an operator that the objective was
being missed. A host cron would be a second, unowned scheduler that the
repository cannot prove; an in-cluster backup would not survive `cluster destroy`.

## Decision

- **The local backup target is `kore data export`.** Encrypted, host-side,
  under `.kore/exports/<environment>`, it survives cluster destruction.
  Managed environments will use provider object storage; that is **not yet
  implemented** and stays deferred to Step 7 / the managed objective (`planned`).
- **The schedule is an objective, not a cron.** The retained-data RPO is the
  `data-export` objective in `infra/catalog/recovery.yaml`, already
  schema-validated up front (`rpoMinutes` must be a positive whole number;
  `kore ops recovery`). No new field was needed.
- **`kore platform status` gains a read-only `backups` row**, from
  `backupStatus`. With no `data-export` objective for the environment there is
  no row. With no retained data the row is `ready`. With retained data it is
  `ready` while the newest export whose digest still matches its manifest is
  within the RPO, and `degraded` when older or absent, naming the age, the RPO,
  and `kore data export --environment <env>`. An unreadable cluster is `missing`.
- **Metadata only.** It reads manifest `createdAt` and the artifact digest
  through `newestVerifiedExport` (kore's own export code). It never decrypts
  and never reads key material; the cluster side is `kubectl get` only.
- **Audit-only.** The row does not close the admission gate and does not
  affect `platform up`: it is built only in `platformStatusReport`, which
  bootstrap and `app up` never call. `kore platform status` also leaves its
  exit code unchanged by this row. ADR 0067 makes status exit non-zero while a
  _prerequisite_ is unready; a stale backup is not a prerequisite of admitting
  applications, and a developer machine routinely goes a day without an export,
  so failing status would train operators to ignore it. This follows the
  precedent of `crd-ownership` and does not contradict ADR 0067.

## Consequences

- A missed RPO is visible in `kore platform status` and `--json` (`backup`
  holds `rpoMinutes` and `ageMinutes`); nothing runs an export for the operator.
- Exports made by an older Kore without a verifiable manifest do not count.
- Not proven live: no cluster was touched; the row is covered by fakes and
  temp directories.
