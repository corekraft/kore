# Resource Budgets and Capacity Warnings

What the local profile is sized for and how Kore warns before it runs out.

## The budget

The profile's size is two overlay values in
[`infra/environments/local/environment.yaml`](../../infra/environments/local/environment.yaml):
`cluster.cpus` and `cluster.memoryMB` (schema minimums: 2 CPUs, 4096 MB), plus
`cluster.diskSize` for the node disk. The shipped defaults (4 CPUs, 8192 MB,
40g) fit the full platform: controllers, Istio ambient, Crossplane,
CloudNativePG, the observability stack, and the reference application.
**Gap:** the shipped sizes are not derived from measured peak usage; they are
what the live bootstrap has run with. Resize them when the warning below fires.

Changing `cpus` or `memoryMB` takes effect only on a new profile:
`kore local down --environment local --prune` (after `kore data export` if
anything is retained), then `kore local up --environment local`.

Storage budgets are the claims' sizes: the registry store is 10Gi
(`storage.size` in the `oci-registry` chart); the observability claims are set
in `infra/environments/local/values`. Claims are on `kore-standard` (`Delete`)
unless they hold retained data ([storage classes](../../README.md#storage-classes)).

## Capacity warning

`kore platform status --environment local` includes a `capacity` row. It
compares the CPU and memory **requests** of every pod that is not finished with
the nodes' allocatable CPU and memory, and is degraded at or above 80% of
either:

```sh
kore platform status --environment local --json
```

The detail names the overlay value to raise (`cluster.cpus` or
`cluster.memoryMB`). The check is read-only, uses the configured kube context,
and is audit-only: it never fails `kore platform up` or `kore app up`. A cluster
that cannot be read reports the row as `missing`.

Requests, not live usage, are compared because the scheduler refuses a pod when
requests do not fit; a high request total predicts pending pods before they
happen. **Gap:** live CPU and memory use (`kubectl top`) is not checked, there
is no disk-pressure or claim-usage warning, and the application namespaces have
no ResourceQuota or LimitRange.
