---
status: accepted
summary: The signed-in golden-path BFF keeps its sessions in Spring Session JDBC on a database the platform PostgreSQL API claims per Service, not in Redis or Valkey, so it scales past one replica.
date: 2026-11-23
last-verified: 2026-11-23
---

# ADR 0182: The golden-path BFF keeps its session in the platform PostgreSQL database

Source: [issue 1841](https://github.com/corekraft/kore/issues/1841), for [`infra/plans/15-next-horizon.md` § Step 7](../../infra/plans/15-next-horizon.md)

Refines: [ADR 0046](0046-bff-jvm-with-agent-and-aot-cache.md) (the BFF template's image and training run are unchanged, and `application.yaml` still holds no private value), and [ADR 0049](0049-data-store-implementations.md) (it names Valkey for the key-value store, which this decision does not need).

## Context

While `golden-path-signin` is on, the BFF holds its sign-in session and the
OAuth2 authorization request in memory. A callback that lands on another replica
finds neither and ends at `/login?error`. Issue 1837 therefore ran the signed-in
BFF as one pod with no autoscaler, so it had no high availability and did not
scale out. The session has to live where every replica can read it.

Two stores were open: Spring Session JDBC on the platform PostgreSQL API, or
Redis (Valkey).

## Decision

- **Spring Session JDBC on a database the platform PostgreSQL API claims.** The
  PostgreSQL API ([ADR 0008](0008-crossplane-postgresql-platform-api.md),
  [ADR 0020](0020-postgresql-api-scoped-rbac-status-and-retention.md)) is built
  and installed, and Keycloak and Backstage already claim a database through it;
  Backstage keeps its sessions' server state in its claim the same way.
- **Not Redis or Valkey.** Valkey ([ADR 0049](0049-data-store-implementations.md))
  is only named: no chart, image, catalog entry, readiness check or platform API
  exists, and its operator or chart is unchosen. It would add a second kind of
  stateful service for one template. Upstream Redis would need its own exception
  ADR. A session is rebuilt by signing in again, so the store needs no cache speed
  beyond a small PostgreSQL.
- **The workload chart claims one `PostgreSQLInstance` per signed-in Service, only
  while `signin.enabled`.** It follows `platform-backstage/templates/database.yaml`:
  `serviceClass: standard`, `retentionPolicy: Delete`, a small `storageSize` and
  the `compatibilityVersion` as chart values. The claim is `<service>-db`, with
  the connection output `<service>-db-connection` and the Secret `<service>-db-app`
  that the composition's cluster owns. The BFF reads the connection output (host,
  port, database, sslmode, username) and the password by reference into the
  standard `SPRING_DATASOURCE_*` variables; nothing private is rendered or
  committed. With sign-in off the render is byte-identical to before.
- **Sessions are not retained data.** A lost session is rebuilt by signing in
  again, so the claim is not retained, no recovery objective is needed, and the
  claim deletes with the release. The platform storage classes `kore-standard` and
  `kore-retained` are what the API uses underneath; the claim itself goes through
  the PostgreSQL API, not through `platform-storage` directly.
- **The datasource exists only with sign-in on.** The template excludes Spring
  Boot's `DataSourceAutoConfiguration` and builds the one connection pool in a
  configuration that matches only when sign-in is on. With it off there is no
  database, no JDBC session and no session cookie, so the AOT training and verify
  runs (`-Dspring.context.exit=onRefresh`, no database) still refresh the context
  and the AOT cache stays valid. With it on, a missing datasource variable refuses
  to start and names the variable.
- **Schema creation is safe when replicas start together.** Spring Session's own
  script is a plain `CREATE TABLE`, which fails on the second start and when two
  replicas race. The template runs an idempotent copy (`IF NOT EXISTS`) in one
  transaction that first takes a PostgreSQL advisory lock, so replicas take turns.
  A test compares the copy with the pinned release's script, and a race of eight
  simultaneous creations passed against PostgreSQL 17.
- **Timeout and cleanup are set.** A session lasts 30 minutes from its last
  request, matching the platform realm's SSO idle time, and each replica deletes
  expired rows every five minutes. The database is left out of `/actuator/health`,
  so a database blip does not make liveness restart every replica.
- **The one-replica rule is removed.** The `$singleBff` condition leaves
  `workload.yaml`, so the signed-in BFF autoscales like the frontend, and the
  `minReplicas >= 2` guard applies to it again.

## Consequences

- The signed-in BFF can run two or more replicas. That claim is not ticked until
  `npm run test:live:golden-path-load` and `npm run test:live:golden-path-signin`
  pass with sign-in on and two or more BFF replicas, and the outcome is recorded
  on issue 1841.
- `golden-path-signin` stays off in every overlay; turning it on remains a
  separate step after a recorded live outcome.
- Each signed-in Service gets one small PostgreSQL cluster, which costs memory and
  start time; the golden-path namespace carries the claim.
- The session cookie is named `SESSION` (Spring Session's default) instead of
  `JSESSIONID`; its attributes are unchanged and the checks that read cookies do
  not depend on the name.
- A session still dies with its database. Deleting the Service deletes the claim.
- A later move to Valkey is a swap of the template's session dependency and the
  chart's claim; it needs the Valkey component first.
