# Reaching a database by name

A PostgreSQL claim can be reached from the host by name, on port 5432, with the
database's own certificate checked against the local CA. This guide is the
client side. It applies only while the `database-routes` flag is on, and that
flag is off in every environment today: until a recorded live run turns it on
for an environment ([ADR 0136](../decisions/0136-the-shared-gateway-serves-database-routes-on-a-loopback-5432-passthrough-listener-behind-database-routes.md),
[ADR 0137](../decisions/0137-the-postgresql-composition-becomes-a-chart-that-takes-database-routes-behind-database-routes.md)),
the commands below do not reach a database.

## The name

A database named `orders-db` (its claim's composite name) is reached as:

```text
orders-db.platform.kore.internal
```

The host is `<database>.<organizationId>.<platform domain>`. For the local
environment the organization is `platform` and the domain is `kore.internal`.
The name is unique per organization, so two claims with the same name in
different namespaces collide.

## Connect

Read the database's user and database name from its connection Secret (the
Secret named by the claim's `connectionSecretName`). Its keys `externalHost`,
`externalPort` and `externalSslmode` carry the name, the port and the SSL mode.
Use `psql` from PostgreSQL 17 or newer: `sslnegotiation=direct` (the TLS
handshake without the plain-text prelude) needs libpq 17 or later on the client.

```sh
psql "host=orders-db.platform.kore.internal port=5432 dbname=app user=app \
  sslmode=verify-full sslnegotiation=direct \
  sslrootcert=$(mkcert -CAROOT)/rootCA.pem"
```

`sslmode=verify-full` checks the server certificate against the local CA and
checks that the host name matches the certificate. The CA is the mkcert root
that `kore trust install` keeps. Do not use `sslmode=require`: it encrypts
without checking who the server is.

The password comes from the Secret named by `passwordSecretRef`. Read it there
and pass it through `PGPASSWORD` or a prompt; do not put it in a command line or
a file.

## Postgres 16

A database on Postgres 16 has no certificate, so it is not reachable by name.
Its status carries a `ReachableByName` condition that is `False` with reason
`UnsupportedVersion`. Use a port forward to the database's read-write Service
instead:

```sh
kubectl --context k3d-kore-local -n <namespace> port-forward svc/<database>-rw 5432:5432
```

Then connect to `localhost` with `sslmode=require` (the forward does not carry
the name, so the certificate cannot be verified this way).

## Opting out of the host port

The local overlay maps host port 5432 to the cluster while `database-routes` is
on. A developer with a native PostgreSQL on 5432 can opt out: set `optOut: true`
on that entry in `infra/environments/local/environment.yaml` (`k3d.ports`). The
host port is then not taken, `kore local up` still runs, and databases stay
reachable inside the cluster and through the port forward above, but not by
name from the host.

## Related

- [Application onboarding](application-onboarding.md): the claim an application
  declares.
- [Troubleshooting](troubleshooting.md): what to do when `kore local up` refuses
  a port.
