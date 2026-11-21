---
status: proposed
summary: Ansible host changes declare the same safety patterns as cluster changes, k3s upgrades go only through the Ansible version pin one minor at a time inside a maintenance window held as repository data, after a datastore snapshot, restarting k3s in place and never draining, and a validate check fails when the k3s pin and the overlay's kubernetesVersion disagree.
date: 2026-11-20
last-verified: 2026-11-20
---

# ADR 0151: Host and k3s changes follow the same safety patterns and run in a maintenance window

Source: [issue #1479](https://github.com/corekraft/kore/issues/1479), grilled against the owner interview record in [issue #1478](https://github.com/corekraft/kore/issues/1478) (decisions 3 and 8).

Refines: [ADR 0141](0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md) and [ADR 0142](0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md).

## Context

The owner's promise is that a change never takes an app down, while infrastructure events (a kernel reboot, a k3s upgrade) can, and are scheduled and recover without a hand. A single node cannot drain: a PodDisruptionBudget guards evictions, so `kubectl drain` hangs on it. Today the base role installs unattended security upgrades daily and sets no reboot policy, so a new kernel waits for someone to reboot. `k3s_version` (`v1.37.2+k3s1`) and the overlay's `kubernetesVersion` (`1.37.2`) are two copies of one fact, guarded only by a literal in a test.

## Decision

- **Host changes use the cluster's patterns.** A no-behaviour-change host change is proven by a check-mode run from kore-agents showing `changed=0` (`mise run vps-check`). A behaviour change merges flag-off, reading its flag from the vps overlay as `k3s-registry-trust` does, and activates after a live outcome.
- **k3s upgrades have one path.** Only the Ansible `k3s_version` pin, one minor version at a time, inside the maintenance window, restarting k3s in place and never draining. The role takes a datastore snapshot first. `kubernetesVersion` in the overlay moves in the same pull request, and a validate check fails when the two disagree.
- **A k3s upgrade cannot be flagged,** so it is its own event in the window. Its rollback is restoring the pre-upgrade datastore snapshot and reinstalling the previous pin in the same window.
- **The window is repository data:** a day of the month and an hour in UTC in the vps inventory. The k3s upgrade tasks refuse to run outside it unless the run names an override the playbook prints.
- **The registry CA is installed by the k3s role, with no by-hand step (owner, 2026-11-20).** Behind `k3s-registry-trust`, the role reads the registry's public `ca.crt` from its Secret with the host kubeconfig, writes it and `/etc/rancher/k3s/registries.yaml`, and restarts k3s only on change. Until `kore platform up` has deployed the registry the task skips and says so, and the next `vps-apply` converges it. Ansible owns it, not OpenTofu (ADR 0141). Only the public certificate is read; the key never leaves the cluster. This replaces ADR 0142's export of the CA file to the controller.
- **Kernel reboots are scheduled.** `unattended-upgrades` gets `Automatic-Reboot` true with the reboot time inside the window, only when a reboot is required. The host must recover without a hand: k3s, Tailscale and the Incus VMs start on boot, and a boot drill proves it before the first app.

## Consequences

- A kernel reboot is a short scheduled outage of everything on the host, the agents VM included. This is the accepted cost of a single node.
- The k3s pin and the overlay cannot drift apart unnoticed.

## Open owner decisions

- **The window's day and hour.** The record has none. Proposal: the first Sunday of the month at 03:00 UTC.
- **The short outage for the Incus VMs that share the host** on an automatic reboot, since the `Automatic-Reboot` setting is new.
