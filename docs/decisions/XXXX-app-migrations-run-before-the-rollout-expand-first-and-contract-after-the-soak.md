---
status: proposed
summary: An application's migrations run as an Argo CD PreSync hook Job from the new image; a normal release carries only expand migrations, checked by a fail-closed DDL allowlist and an N-1 test, and a contract migration ships alone, in a later release, after the soak, with its soak length and backup precondition left to the owner.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR XXXX: App migrations run before the rollout, expand first and contract after the soak

Source: [#1485](https://github.com/corekraft/kore/issues/1485), decisions 3, 4, 7 and 8 of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478), and its migrations gap

Refines: [ADR 0024](0024-reference-app-database-access.md) (the migration hook), [ADR 0107](0107-the-judge-precheck-accepts-a-contract-once-its-expand-step-is-proven.md) (a contract names its expand step)

## Context

ADR 0024 runs the reference application's migration as a Helm `pre-install,pre-upgrade`
hook Job, so the schema changes before new pods roll out and a failed migration fails
the release. That hook lives in `apps/reference/charts/workload`, which `kore app up`
installs with Helm. The Argo-delivered `golden-path-workload` chart has no migration
hook, so a delivered application has no way to migrate. The Job and the runtime also
share one CloudNativePG credential, which owns the database. The promise is that a
change never takes an application down (record 3), and a contract step waits for the
soak (record 7).

## Decision

- **A PreSync hook Job in the platform chart.** The Argo-delivered workload chart
  gains the hook, with ADR 0024's shape: its own ServiceAccount, a deadline, the
  hardened security context, and the hook delete policies `before-hook-creation` and
  `hook-succeeded`. It runs from the new image before pods roll. A failure fails the
  sync, and the old pods keep serving (`maxUnavailable: 0`). Argo CD runs a PreSync
  hook on every sync, including a flag-state change, so migrations are idempotent
  (an advisory lock and a `schema_migrations` table, as ADR 0024 has).
- **A normal release carries only expand migrations.** Each migration is classified
  `expand` or `contract` in the `migration-plan` attestation. A static allowlist of
  expand DDL (CREATE TABLE, ADD COLUMN nullable or with a default, CREATE INDEX
  CONCURRENTLY, ADD CONSTRAINT NOT VALID) is the only expand; any other, and any
  statement the evals do not recognise, is a contract (fail closed). The evals
  refuse a contract migration in a release that is not a contract release.
- **N-1 compatibility is tested.** For an application with a database, the
  workflow applies the new migrations to a scratch database and runs the previous
  release's test suite against it. A failed hook leaves the old pods serving only
  when the expand is backward compatible, which this test checks.
- **A contract ships alone, in one of two kinds.** Both are their own release, with
  no other behaviour change, and both name the release in which the thing was
  last used, as ADR 0107 has a contract name its expand step. A _data contract_
  carries contract migrations only: the eval compares the commit with the named
  release and fails unless the diff touches only the application's declared
  migrations path and tests, and the flags manifest is unchanged. A _code
  contract_ retires a flag: it deletes the flag and its off path, so it touches
  code and removes the flag from the manifest, and it carries no migration.
- **Contract waits for the soak.** The platform allows a contract only when the
  named release has run on vps with all its replacement flags on for the soak
  window and no revert has happened since. Migrations are forward-only: a revert
  of a release never rolls a migration back.
- **Open owner decisions.** The soak window's length (recommended: 7 days,
  lengthened per application, never shortened); a contract also requiring a
  restorable backup of that database younger than 24 hours, so an application with
  data that has not opted into backup cannot ship a contract at all (recommended:
  yes, since an irreversible drop with no copy breaks the promise); and a split of
  the credentials into a migration credential with DDL rights and a DML-only runtime
  credential (recommended as a hardening follow-up for the PostgreSQL composition).

## Consequences

- An application with a database can be delivered, migrated and reverted without
  Helm, and a failed expand never takes a running pod down.
- The reference chart's hook and the platform chart's hook are two copies until the
  reference moves onto the platform chart.
- The contract's backup precondition depends on the backup mechanics of concept 3
  (#1481); this ADR fixes only the precondition.
