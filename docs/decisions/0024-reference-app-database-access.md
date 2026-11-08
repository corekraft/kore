---
status: accepted
summary: The reference app authenticates to PostgreSQL with a std-lib SCRAM-SHA-256 client, injects the password by secretKeyRef, proves readiness with an authenticated SELECT 1, and applies schema through a Helm pre-install/pre-upgrade hook Job.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0024: Reference app database access and schema migration

Source: [`infra/plans/2-implementation.md` § Progress Record](../../infra/plans/2-implementation.md#progress-record)
(Step 12)

Refines: [ADR 0008](0008-crossplane-postgresql-platform-api.md)

## Context

The reference app consumed only `host`, `port`, `database`, and `username`.
The password was never injected and `databaseReady()` opened a bare TCP
socket, so "database access" was not proven. No schema operation existed.

## Decision

- **Client: a minimal std-lib PostgreSQL client** (`apps/reference/src/postgres.ts`):
  startup, optional TLS upgrade, SCRAM-SHA-256 with server-signature
  verification, and the simple query protocol, on `node:net`, `node:tls`, and
  `node:crypto`. The alternative, an exactly pinned `pg`, would add a runtime
  dependency tree, a lockfile, and an `npm ci` Docker layer, and the app needs
  only `SELECT 1` and a few DDL statements. AGENTS.md makes a runtime
  dependency an architectural decision; here the smaller, safer surface is
  roughly 200 lines tested against a fake server. Revisit if the app needs
  parameterized queries, pooling, or result types.
- **Scope limits, failing closed:** only SCRAM-SHA-256 (other methods error);
  `PGSSLMODE` is `require` (default) or `disable`; anything else, including
  `verify-full`, is rejected rather than downgraded. `require` encrypts without
  verifying the certificate, as libpq does, and refuses to send credentials if
  the server offers no TLS. Passwords are used as-is (no SASLprep), which holds
  for the generated ASCII passwords CloudNativePG creates.
- **Password injection:** `PGPASSWORD` comes from a `secretKeyRef`, never a
  value. The connection Secret contract carries `passwordSecretRef` (the name
  of the password Secret) but no password, and Helm cannot dereference a
  Secret value at render time. The workload chart therefore takes
  `database.passwordSecret.{name,key}` (default `reference-db-app` /
  `password`, what the local composition's `passwordSecretRef` names).
  `PGSSLMODE` comes from the contract's `sslmode` key.
- **Readiness:** `databaseReady()` connects, authenticates, and runs
  `SELECT 1`. A missing password, rejected credentials, or an unreachable
  server make `/readyz` return 503.
- **Migration: a Helm `pre-install,pre-upgrade` hook Job** in `charts/workload`
  running `src/migrate-main.ts` from the same image. Schema therefore changes
  before new pods roll out and a failed migration fails the release instead of
  leaving running pods on the wrong schema; a startup step would run per replica
  and couple pod start to DDL. The Job has its own ServiceAccount, mesh and
  identity labels, a deadline, and the same hardened security context. The
  migrations are an append-only list in `src/migrate.ts`; a run takes one
  transaction under `pg_advisory_xact_lock`, creates `schema_migrations`,
  applies unrecorded ids, and rolls back on failure, so reruns and concurrent
  runs are safe. `npm run migrate` runs the same entrypoint by hand.

## Consequences

The hook Job needs the database and both Secrets to exist before the workload
release, so the resources release must be installed first (it already is); the
Job waits on missing Secrets until its deadline. The `passwordSecret` default
duplicates the composition's naming; adding a `password` key to the connection
Secret contract would remove it and is a separate decision about ADR 0008.
Hook resources are not part of the release, so Helm does not remove them on
`helm uninstall`. The hook policies bound what is left: `hook-succeeded` removes
the completed Job and the hook ServiceAccount, while a failed Job is kept for
diagnosis until the next hook run (`before-hook-creation`) or namespace removal.
Only the api receives database environment (including `PGPASSWORD`); the
frontend never sees the credential. Every database query has a per-query
deadline that destroys the socket, in addition to the connect timeout.