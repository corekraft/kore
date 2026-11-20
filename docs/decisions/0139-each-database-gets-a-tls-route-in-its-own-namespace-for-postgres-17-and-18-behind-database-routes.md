---
status: proposed
summary: With database-routes on, the PostgreSQL composition emits one TLS route per Postgres 17 or 18 database in the database's own namespace, attached to the Gateway's postgres listener and backed by its read-write Service; Postgres 16 and the flag off get none.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0139: Each database gets a TLS route in its own namespace for Postgres 17 and 18 behind database-routes

Source: [GitHub issue #1223](https://github.com/corekraft/kore/issues/1223), under #1195 (databases by name) and #1191; refines [ADR 0137](0137-the-postgresql-composition-becomes-a-chart-that-takes-database-routes-behind-database-routes.md), which leaves the TLSRoute out of its decision, and uses the listener of [ADR 0136](0136-the-shared-gateway-serves-database-routes-on-a-loopback-5432-passthrough-listener-behind-database-routes.md).

## Context

ADR 0137 gives each database a name, a certificate and a connection Secret that
reports the name. ADR 0136 gives the shared Gateway a `postgres` passthrough
listener. Nothing yet connects the two: no route names the database on the
listener. A route also decides what a client can reach, so it must not cross a
namespace without an explicit grant.

## Decision

- **One TLSRoute per database, in the database's namespace.** The composition
  emits a `gateway.networking.k8s.io/v1` `TLSRoute` named after the composite,
  in the composite's namespace, with the derived host
  (`<database>.<organizationId>.<domain>`, ADR 0137) as its only hostname. It
  attaches to the Gateway's `postgres` listener by `sectionName`.
- **The backend is the read-write Service beside it.** The route's backend is
  `<database>-rw` on port 5432 and names no namespace, so it resolves in the
  route's own namespace. No `ReferenceGrant` is composed, and none is needed:
  a route reaches another namespace only through one.
- **Supported versions only.** The route is composed for Postgres 17 and 18, the
  versions that get a certificate (ADR 0137), and not for Postgres 16, which
  already reports `ReachableByName` as `False`. A route to a database that
  cannot present the certificate its name promises would fail the client's
  handshake, so none is emitted.
- **Only with the flag on.** The route renders in the flag-on composition alone.
  The flag-off composition and definition stay byte-identical (ADR 0137).
- **The Gateway comes from the environment.** The chart takes `gateway.name`
  and `gateway.namespace`, which kore passes from the environment's `gateway`
  only while `database-routes` is on, on the Helm path through
  `platformHelmArgs` and on the Argo CD path as `gatewayName` and
  `gatewayNamespace` of `kore-config-delivery`, which become Application
  parameters. They have no default and the chart refuses to render without
  them. The listener's name, `postgres`, is `gateway.sectionName`, the name
  ADR 0136 gives the listener.
- **Crossplane may manage TLS routes only with the flag on.**
  `crossplane-postgresql-composition` gains `gateway.networking.k8s.io`
  `tlsroutes` with the verbs it has for Clusters and Certificates, when the
  chart's `databaseRoutes` is set. No other Gateway API kind is granted.
- **Admission is the listener's.** The `postgres` listener admits routes by the
  same selector as the HTTPS listeners (ADR 0134): with `platform-shared-gateway`
  on, only namespaces carrying `platform.kore.dev/shared-gateway: "true"`, which
  `kore app up` already adds to an application namespace. This step adds no
  admission rule.

## Consequences

- The activation constraint of ADR 0137 holds: a release lock older than this
  chart ignores the new values and composes no route, so activation waits for
  a release that publishes it.
- A database in a namespace without the shared-gateway label gets a route that
  the Gateway does not admit, and is not reachable by name; the route's status
  says so. Application namespaces `kore app up` creates carry the label.
- Two databases with one name in different namespaces still collide on their
  host, as ADR 0137 records; the second route is not accepted by the Gateway
  until a later step refuses the claim.
- The route is not proven against a running Gateway here. The shared names live
  run proves it before the flag turns on.
