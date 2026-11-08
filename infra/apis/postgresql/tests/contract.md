# PostgreSQLInstance contract assertions

The contract is executable offline in
`tools/kore/src/platform/platform.postgresql-api.spec.ts`: it asserts that only
the five portable inputs are accepted, the local composition creates a
CloudNativePG `Cluster` whose PVCs inherit the claim's retention label, the
connection Secret exposes exactly `host`, `port`, `database`, `username`,
`passwordSecretRef`, and `sslmode`, a `Retain` claim selects `kore-retained`,
and CloudNativePG phase, failure reason, and endpoint reach the composite status.

`kore app down` leaves the claim and database intact and reports retained
resources (`tools/kore/src/app/app-lifecycle.spec.ts`). Live tests must still
show the same against a real cluster.
