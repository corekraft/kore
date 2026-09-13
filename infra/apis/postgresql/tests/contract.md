# PostgreSQLInstance contract assertions

Offline and live tests must assert that only the five portable inputs are
accepted, the local composition creates a CloudNativePG `Cluster`, and the target
Secret exposes `host`, `port`, `database`, `username`, `passwordSecretRef`, and
`sslmode`. A `Retain` claim selects `kore-retained`; lifecycle tests must show that
workload removal leaves both the claim and database intact.

