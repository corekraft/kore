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

## Declared node count, reserves and committed fraction

An environment states what its one-node budget is made of
([ADR 0152](../decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md)),
so the feasibility check, the disruption budget and the capacity budget read
the same facts. The fields are in the overlay and the
[schema](../../infra/environments/schema.json):

- `nodeCount` (top level): whole nodes the environment runs. Unset reads as `1`,
  so every existing overlay keeps its meaning. The vps overlay declares `1`.
- `committedFraction` (top level): the share of the budget app quotas may
  commit, from `0` to `1`. Unset reads as `0.8`.
- `cluster.kubelet` (managed only): the kubelet's `kubeReserved` and
  `systemReserved` (`cpu` as `500m` or `1`, `memory` as `512Mi` or `1Gi`) and its
  `evictionHard.memory` floor.
- `cluster.diskReserve` (managed only): disk kept back from `cluster.diskSize`,
  in GiB such as `20g`.

Allocatable is the declared compute less those reserves, per node. The vps
reserves and disk reserve stay absent until the vps measurement records them,
so its budget is not judged: no capacity verdict is made on an absent reserve.
`kore validate` refuses a `nodeCount` below 1, a `committedFraction` outside
0 to 1, an unreadable quantity, and reserves that leave no allocatable CPU,
memory or disk, naming the field each time.

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
