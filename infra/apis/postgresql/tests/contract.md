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

`kore app down` leaves the claim and database intact and reports retained
resources (`tools/kore/src/app/app-lifecycle.spec.ts`). Live tests must still
show the same against a real cluster.
