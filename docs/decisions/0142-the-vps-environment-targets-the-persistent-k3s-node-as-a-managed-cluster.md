---
status: accepted
summary: The vps environment overlay points kore at the persistent single-node k3s on the rented VPS as a managed cluster, with the k3s facts it can read, the local domain kore.internal and every feature flag off, so the overlay validates and changes nothing in any cluster until a live run and harness flag activate.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0142: The vps environment targets the persistent k3s node as a managed cluster

Refines [ADR 0012](0012-environment-overlays-hold-provider-specifics.md), which keeps provider specifics in overlays, and builds on [ADR 0141](0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md), which converges the host and its k3s.

## Context

ADR 0141's Ansible role runs a single-node k3s on the rented VPS host, and
kore has no environment to target it. Kore created its k3d and managed
clusters through overlays, but this cluster is neither: Ansible installs and
owns it, and kore only deploys to it. Kore needs an overlay, so `kore validate`
and the platform charts can address it, without that overlay turning anything on.

The cluster's facts are: k3s v1.37.2+k3s1 on one node, SQLite datastore,
Traefik and servicelb disabled, the `local-path` storage class as default,
the k3s default service CIDR, eight threads and about 64 GiB RAM shared with a 6-CPU,
40 GiB agents VM, and an API reachable only over the tailnet. The repository
is public, so no public address, tailnet address or MagicDNS name beyond the
bare host name `kore-vps` belongs in it. The owner has not bought a domain, so
no real domain belongs in it either.

## Decision

- **A managed overlay, not a k3d one.** `infra/environments/vps` has provider
  `managed`, cluster profile and driver `external` (kore does not create the
  cluster), containerd and Kubernetes `1.37.2`, matching `managed-example`.
  The context is `kore-vps`, the name the Ansible role writes.
- **Sized for kore, with room for the VM.** `cpus` 4 and `memoryMB` 20480
  (20 GiB) leave the agents VM its 40 GiB cap and the host the rest of the
  64 GiB. k3s already outranks the VM for CPU and IO (ADR 0141), so the
  declared share is what kore may plan for, not a reservation. `diskSize` is
  `300g`, the k3s data volume.
- **The local domain convention.** `platform.domain` is `kore.internal`
  with organization `platform`. The name resolves nowhere public, so nothing
  reaches the internet by it, and it is never a bought domain.
- **The release mirror, not upstream.** Like `managed-example`, the overlay
  pulls every approved image from the signed, digest-pinned mirror
  (ADR 0044), with the same keyless image trust over the release tags. No
  local signing key is declared, because a managed environment trusts only
  keyless signers (ADR 0059).
- **Every flag off.** All feature flags are listed and `false`. A flag turns on
  only through `harness flag activate` after a recorded live-run outcome
  (ADR 0077), so this change alters nothing that runs in the cluster.
- **A conservative registry name.** `registry.kore.internal` is a placeholder
  that resolves to nothing. Which registry the cluster uses is an open question
  (see the pull request).

## Consequences

- `mise run validate` checks `vps` in CI beside `local` and `managed-example`,
  so a broken overlay fails before merge.
- The overlay copies managed-example's mirror and manifest values, so the two
  overlays drift apart whenever the release mirror changes; the copies must
  be updated together until one shared source exists.
- No live proof exists for this environment yet. Turning a flag on for `vps`
  needs its own live run and activation, and any cluster change needs a
  separate decision.
