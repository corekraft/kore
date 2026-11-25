# PostgreSQLInstance contract assertions

The contract is executable offline in two specs. `platform.postgresql-render.spec.ts`
renders the composition's Go templates with `helm template` (the same template
engine and Sprig functions as function-go-templating; `crossplane render` needs
a container engine for its functions, so it is not offline) and asserts the
connection Secret keys and values, the `Retain` to `kore-retained` and `Delete`
to `kore-standard` storage mapping, the pinned image per compatibility version,
and the projected status and `DatabaseHealthy` condition for healthy, failing,
and not yet observed databases.
`tools/kore/src/platform/platform.postgresql-api.spec.ts` asserts that only
the five portable inputs are accepted, the local composition creates a
CloudNativePG `Cluster` whose PVCs inherit the claim's retention label, the
connection Secret exposes exactly `host`, `port`, `database`, `username`,
`passwordSecretRef`, and `sslmode`, a `Retain` claim selects `kore-retained`,
and CloudNativePG phase, failure reason, and endpoint reach the composite status.

With database-routes on, `tools/kore/integration/platform/platform.postgresql-route-ready.spec.ts`
asserts that a database's TLS route is ready only once the observed route has Accepted and
ResolvedRefs True for the shared Gateway, and that a route the Gateway refused projects a False
`DatabaseRouteReady` condition with the Gateway's reason (issue 1472).

With postgresql-service-class-instances on (ADR 0154), `platform.postgresql-service-class.spec.ts`
asserts the composed Cluster's spec exactly: a `standard` claim gets two instances with the
disruption budget on, a `development` claim one with it off; both use `primaryUpdateMethod:
switchover` and a memory request equal to the limit. Off, every class composes the one-instance
Cluster with no sizing, with or without database-routes. The flag is declared off in every overlay
(`integration/config/service-class-flag.spec.ts`).

With database-role-split on (ADR 0171), `platform.postgresql-database-role-split.spec.ts` asserts
that the composed Cluster declares two managed roles beside the existing app owner: `app_ddl`, a
member of the owner, which runs the migration, and `app_dml`, with no membership, no ownership and
no schema or role privilege, which runs the workload. Each role's password comes from a Secret
(`<database>-ddl`, `<database>-dml`) that an External Secrets Password generator creates and
refreshes at `databaseRoles.rotationPeriod` (720h by default), and that CloudNativePG reloads
through its `cnpg.io/reload` label. The connection Secret still names the app role. Off, the
chart renders byte-identical to its golden renders (`integration/platform/fixtures/`). The flag is
declared off in every overlay (`integration/config/database-role-split-flag.spec.ts`).

`kore app down` leaves the claim and database intact and reports retained
resources (`tools/kore/src/app/app-lifecycle.spec.ts`). Live tests must still
show the same against a real cluster.
