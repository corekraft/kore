---
status: accepted
summary: A rented VPS host keeps its packages, firewall, sshd and Tailscale as desired state in infra/hosts/vps, converged over the tailnet by a pinned ansible-core; the provider OS install and the Tailscale sign-in stay manual, and account-level state such as the tailnet policy belongs to OpenTofu.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0141: The VPS host is converged by an Ansible playbook in the repository

Source: [`infra/plans/15-next-horizon.md` § Step 5](../../infra/plans/15-next-horizon.md#step-5-platform-argo-cd-delivery-from-git)

## Context

Kore needs a machine bigger than a laptop: a runtime for agent panes and a
persistent, long-running cluster that converges from git. That machine is one
rented dedicated server (four old cores, 64 GB, two HDDs in software RAID1).
Its host layer (packages, automatic security updates, a firewall, sshd, kernel
settings, Tailscale, and later Incus and k3s) is desired state like anything
else, and it drifts if it lives only in shell history.

A hand-written shell script that is safe to rerun would reimplement
reconciliation, which kore leaves to upstream tools. Chef and Puppet need an
agent and usually a server for one host. cloud-init only covers first boot.

## Decision

- **Ansible owns the host.** A playbook in `infra/hosts/vps` with the roles
  `base`, `tailscale` and `network` is the source of truth for the host. Later
  roles (Incus, k3s) join it. `mise run vps-check` shows the diff without
  changing anything; `mise run vps-apply` converges. Only `ansible.builtin`
  modules are used, so no collection needs pinning.
- **Pinned like every other tool.** `ansible-core` and `ansible-lint` are exact
  versions in `.mise.toml`; the Tailscale package version and its apt key
  checksum are role defaults.
- **The tailnet is the only way in.** The inventory names the host by its
  tailnet name. The firewall owns one nftables table, `kore_host`, which drops
  inbound traffic except loopback, replies, the tailnet, Tailscale's WireGuard
  port, ICMP and DHCP replies. It never flushes the ruleset, so the tables
  Tailscale, Incus and k3s own survive a reload, and it leaves forwarding to
  them. A newly applied firewall arms a timer that removes it unless the
  playbook reconnects and disarms it.
- **Two steps stay manual.** The provider's OS install and partitioning happen
  once in its control panel, and `tailscale up` needs a person to approve the
  sign-in. The playbook refuses to close public SSH until the host is signed in.
- **Ownership boundaries.** Ansible owns what is on the host. OpenTofu owns
  account-level state (the tailnet policy, later DNS and a tunnel). Kore and
  Argo CD own what runs in the cluster.

## Consequences

- Python tooling enters the developer toolchain through mise; the kore CLI and
  its runtime dependencies are unchanged.
- The repository is public, so the host's public address, tailnet addresses and
  any key stay out of it; the inventory carries the tailnet name only.
- Losing the tailnet means losing access; the provider's rescue mode is the
  recovery path.
