---
status: proposed
summary: An application's migrations run as an Argo CD PreSync hook Job from the new image with a DDL-only credential, after a shadow run on a copy of the data; a normal release carries only expand migrations, checked by a fail-closed DDL allowlist and an N-1 test, and a contract ships alone after a per-rollout soak window and against a restorable backup, with a recorded break-glass bypass of the shadow run.
date: 2026-11-20
last-verified: 2026-11-25
---

# ADR 0171: App migrations run before the rollout, expand first and contract after the soak

Source: [#1485](https://github.com/corekraft/kore/issues/1485), decisions 3, 4, 7 and 8 of the owner interview record [#1478](https://github.com/corekraft/kore/issues/1478), its migrations gap, and the owner's answers on #1485 (2026-11-20)

Refines: [ADR 0024](0024-reference-app-database-access.md) (the migration hook and the shared credential), [ADR 0107](0107-the-judge-precheck-accepts-a-contract-once-its-expand-step-is-proven.md) (a contract names its expand step)

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
- **Two credentials.** The hook uses a migration credential with DDL rights; the
  running application gets a DML-only credential, so a buggy release cannot drop a
  table at run time. The PostgreSQL composition emits both (the owner decided this,
  refining ADR 0024's single owner credential).
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
- **A shadow migration runs first, for schema and data migrations alike.** An
  earlier PreSync hook restores the latest backup into a shadow database, runs
  the release's migrations against it, and checks that they succeed and that the
  previous and the new release's suites still pass against the result. The real
  migration hook runs only when the shadow run passed. The shadow run needs the
  restore of concept 3 (#1481) and room on the single node (concept 2, #1480); an
  application without a backup has no shadow run and so cannot ship a contract.
- **Break-glass bypasses the shadow run, recorded and owner-visible.** An emergency
  primitive lets a release skip the shadow run. Every use is recorded with who,
  when, which release and why, and appears in the owner digest. It bypasses nothing
  else: not the signature, the attestations, the allowlist or the backup
  precondition; extending it to those is a separate decision.
- **A contract ships alone, in one of two kinds.** Both are their own release, with
  no other behaviour change, and both name the release in which the thing was
  last used, as ADR 0107 has a contract name its expand step. A _data contract_
  carries contract migrations only: the eval compares the commit with the named
  release and fails unless the diff touches only the application's declared
  migrations path and tests, and the flags manifest is unchanged. A _code
  contract_ retires a flag: it deletes the flag and its off path, so it touches
  code and removes the flag from the manifest, and it carries no migration.
- **Contract waits for the soak and needs a backup.** The soak window is a
  configurable primitive set per rollout, as short as hours; there is no fixed
  minimum, and if the named release holds over the window with all its replacement
  flags on and no revert since, that is enough. The contract release states its
  window; the platform allows the contract only when the named release has run on
  vps that long. A contract migration also needs a restorable backup of that
  database younger than 24 hours; an application with data that has not opted into
  backup cannot ship a contract. Migrations are forward-only: a revert of a release
  never rolls a migration back.

## Role passwords

Source: [#1598](https://github.com/corekraft/kore/issues/1598), which asks for the two
credentials to be "generated and rotated by the operator". This section refines that
wording, because the operator cannot do it.

- **CloudNativePG cannot generate a managed role's password.** A role under the
  `Cluster`'s `spec.managed.roles` takes its password only from a `passwordSecret`
  that something else supplies. CloudNativePG generates a password only for the
  bootstrap owner (`app`). It neither creates nor rotates one for a role it manages.
- **External Secrets generates them.** Behind the `database-role-split` flag, the
  PostgreSQL composition declares two roles: `app_ddl`, a member of the owner, for
  the migration hook, and `app_dml`, with no membership, for the running
  application. For each role it composes an External Secrets `Password` generator
  (48 characters, 12 digits, no symbols) and an `ExternalSecret` that writes the
  `kubernetes.io/basic-auth` Secret `<database>-ddl` or `<database>-dml`. The role
  reads that Secret through its `passwordSecret`. External Secrets is already
  installed and pinned (2.14.0), so this adds no new dependency. The
  `ExternalSecret` owns its Secret (`creationPolicy: Owner`), so each Secret has one
  owner.
- **The rotation period is a chart value.** The `ExternalSecret`'s
  `refreshInterval` is the rotation period. On each refresh, External Secrets runs
  the generator again and writes a new password. The period is
  `databaseRoles.rotationPeriod` in the PostgreSQL API chart, 720h (30 days) by
  default, so changing it needs no code change.
- **CloudNativePG reloads the role.** The generated Secret carries the label
  `cnpg.io/reload: "true"`. CloudNativePG watches Secrets with that label and
  applies a changed password to the role without restarting the cluster.
- **Consumers roll on their own marker.** The reference workload chart takes one
  rotation marker per role (`platform.kore.dev/ddl-secret-version`,
  `platform.kore.dev/dml-secret-version`), as it does with `secretVersion`. A
  rotation rolls only the consumers of the role that changed.
- **Activation waits on the live proof.** `database-role-split` is false in every
  overlay. It turns on through `harness flag activate` only once the live proof in
  [#1603](https://github.com/corekraft/kore/issues/1603) is recorded. That proof
  checks that a rotated database credential rolls its consumer and that the runtime
  role cannot change the schema. So two things must land before it can pass: the
  `kore app up` wiring that sets the role markers, and the reference app's table
  grants to `app_dml`.

## Consequences

- An application with a database can be delivered, migrated and reverted without
  Helm, and a failed expand never takes a running pod down.
- The reference chart's hook and the platform chart's hook are two copies until the
  reference moves onto the platform chart.
- The shadow run and the contract's backup precondition depend on the backup and
  restore mechanics of concept 3 (#1481); this ADR fixes only the preconditions.
- A shadow restore of a large database competes with the agents VM and the cluster
  for one node; a size ceiling per application is a parameter to set in the
  capacity work (concept 2).
