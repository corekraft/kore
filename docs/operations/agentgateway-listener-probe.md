# agentgateway listener probe

One recorded run settles a fact the registry and database designs of
[#1195](https://github.com/corekraft/kore/issues/1195) depend on: whether
agentgateway v1.7.0 serves a TLS passthrough listener and an HTTPS terminating
listener on one port, told apart by hostname, and whether a listener set can add
one of them. The agentgateway docs list both features as supported but show no
mixed-port example and do not map to the pinned version.

The probe is developer tooling (`tools/kore/scripts/agentgateway-listener-probe.sh`).
It changes nothing under `infra/`, so it declares `no-behaviour-change`. The
live run is the deliverable; the recorded result decides the registry and
database fallbacks.

## Run it

One live run at a time, on the idle host, on a throwaway cluster:

```sh
KORE_RUN_AGENTGATEWAY_PROBE=1 tools/kore/scripts/agentgateway-listener-probe.sh
```

Without `KORE_RUN_AGENTGATEWAY_PROBE=1` it prints `skipped` and exits 0.

| Variable             | Default                   | Meaning                                  |
| -------------------- | ------------------------- | ---------------------------------------- |
| `KORE_PROBE_CLUSTER` | `kore-probe-agentgateway` | cluster name, `^[a-z0-9-]+$`             |
| `KORE_PROBE_PORT`    | `18443`                   | host port mapped to the Gateway          |
| `KORE_PROBE_KEEP`    | unset                     | `1` keeps the cluster after the run      |
| `KORE_PROBE_RESULTS` | a file under `$TMPDIR`    | where the results are written, never git |

It needs no worktree, overlay or age key: it does not run `kore local up`, and
it touches neither `.kore/state` nor any Kore cluster. It refuses to start, with
the cause named, when a k3d cluster of the same name exists (it would delete
data it did not create) or when the host port is taken. The cluster is deleted
on exit, including after a failure, unless `KORE_PROBE_KEEP=1`; the certificates
live in a temporary directory removed on exit.

## What it does

Only the Gateway API definitions and the agentgateway controller are installed,
at the versions pinned in `infra/catalog/versions.yaml`. A throwaway CA makes two
certificates, one for `terminate.probe.test` and one for `passthrough.probe.test`.
A stub backend (the pinned nginx image) serves plain HTTP and TLS with the
passthrough certificate.

1. **Mixed listeners.** One Gateway, port 443: an HTTPS listener that terminates
   `terminate.probe.test` with the terminate certificate, and a TLS passthrough
   listener for `passthrough.probe.test` routed to the backend's TLS port. A
   client connects once with each name as SNI.
2. **Listener set.** The Gateway keeps only the HTTPS listener and allows
   listeners from its namespace; a `ListenerSet` adds the passthrough listener.
   The same two connections are made.

A variant works only when each name returns the certificate it must carry:
the terminate name the Gateway's certificate, the passthrough name the backend's
own. A connection alone is not enough. The checks retry for about a minute while
the controller programs the Gateway.

## Read the result

The results file starts with the pinned versions and the expected fingerprints,
then for each variant says `works` or `fails`, the fingerprint and subject seen
for each name, and the status conditions the controller put on each listener.

A failing variant is a result, not an error: the run records it and goes on. Only
a refusal or a broken setup exits non-zero.

| Result                   | Decision                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `mixed listeners: works` | The registry keeps the shared Gateway's port 443 and its own name.                                                          |
| `mixed listeners: fails` | The registry fallback of #1195 applies: the registry gets its own loopback port beside 443, so only its URL carries a port. |
| `listener set: works`    | The later per-organization design may use listener sets.                                                                    |
| `listener set: fails`    | The per-organization design cannot rely on listener sets on this version.                                                   |

Paste the results file as a comment on #1218. The database listener on 5432 is
already a separate port, so it does not depend on the mixed result.
