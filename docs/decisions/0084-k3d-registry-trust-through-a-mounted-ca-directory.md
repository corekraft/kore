---
status: accepted
summary: On k3d, nodes trust Kore's registry CA through a k3s registries.yaml and a host directory mounted into every node at cluster create; kore writes the public CA into that directory after issuance, so no node shell runs. A restart is the recorded fallback if live proof shows containerd does not reread the CA.
date: 2026-11-11
last-verified: 2026-11-11
---

# ADR 0084: Trust the registry CA on k3d through a mounted CA directory

Source: [`infra/plans/9-k3d-local-cluster.md` § Step 3](../../infra/plans/9-k3d-local-cluster.md#step-3-images-and-registry-trust)

Refines: [ADR 0058](0058-registry-transport-tls.md),
[ADR 0076](0076-k3d-replaces-minikube.md).

## Context

ADR 0058 has every registry client verify the registry's TLS against a CA that
cert-manager issues inside the cluster. On Minikube the node's containerd got
that CA over `minikube ssh`. ADR 0076 drops node shells on k3d and says node
trust comes from k3s `registries.yaml` at cluster create. The CA does not exist
yet at create: it is issued later, once the registry's certificate is ready.

## Decision

Cluster create supplies two bind mounts to every node (`--volume ...@all`):

- a host directory, `~/.kore/k3d/<cluster>/registry-trust`, at
  `/etc/kore/registry-ca`; and
- the `registries.yaml` in that directory, at `/etc/rancher/k3s/registries.yaml`.

Before create, kore writes `registries.yaml` with one `configs` entry for the
registry address and `tls.ca_file: /etc/kore/registry-ca/ca.crt`. It names no
mirror and no endpoint, and never skips verification. After issuance,
`ensureRegistryTrust` writes the public CA to `ca.crt` in the host directory;
the mount makes it visible to the nodes with no node access. Only the public CA
is ever written there. The ConfigMap for Policy Controller is unchanged.

Kore's registry stays the only registry. No `--registry-*` flag is used and
k3d creates none.

The mounts are fixed at create, so a cluster created before this change has
neither; `kore local down --prune` then `kore local up` recreates it. `kore local up`
does not yet detect a missing mount, because `k3d cluster list` is not
confirmed live to report volumes; adding that drift check is a gap for the live
proof (#149).

## Fallback

k3s reads `registries.yaml` once at start, and containerd may cache a missing
CA file. If live proof (#149) shows a pull still failing after `ca.crt` is
written, the fallback is to restart the k3s server container once after the CA
is written (`docker restart`, still no node shell). That change records itself
as an addendum here.

## Consequences

The trust path needs no node shell and survives a stop and start, since the
directory is on the host. The CA file lives outside the repository and holds
public material only. The restart fallback remains unproven until the live run.
