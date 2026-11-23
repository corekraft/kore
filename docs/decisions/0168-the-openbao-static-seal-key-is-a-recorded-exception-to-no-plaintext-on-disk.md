---
status: proposed
summary: The vps OpenBao unseals itself with a static seal whose 32-byte key is a root-only plaintext file on the node's root filesystem, a recorded exception to "secrets never touch disk in plaintext", because unattended recovery after the weekly reboot and that rule cannot both hold on one node with no off-box KMS.
date: 2026-11-20
last-verified: 2026-11-23
---

# ADR 0168: The OpenBao static seal key is a recorded exception to no plaintext on disk

Source: [issue #1484](https://github.com/corekraft/kore/issues/1484), the owner's decision of 2026-11-20 on the secret backend, under the platform v1 interview record [#1478](https://github.com/corekraft/kore/issues/1478).

Refines: [ADR 0009](0009-encrypted-secrets-through-external-secrets.md) and the rule "secrets never touch disk or git in plaintext" in `AGENTS.md`. Builds on [ADR 0141](0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md) (Ansible owns the host).

## Context

Application secrets on vps are held by OpenBao behind the existing External Secrets contract ([ADR 0167](0167-application-secrets-come-from-openbao-behind-the-platform-secrets-contract-one-path-per-suborg.md)). OpenBao starts sealed after every restart. The host reboots weekly inside a maintenance window and must recover without a hand. Unsealing by hand (Shamir shares) keeps the plaintext rule but breaks that recovery. Unsealing by a cloud KMS or a second always-on OpenBao is impossible: the box is one node with no off-box service. A TPM seal needs hardware that is not known to exist on the rented machine.

The node already keeps one key beside the data it protects: k3s writes its AES key for Secret encryption to the k3s data directory on the same disks.

## Decision

- **One exception, named.** The static seal key of the vps OpenBao is the only secret allowed to sit on disk in plaintext. No other secret gains this exception, and local keeps sops with age.
- **How it is made and placed.** The 32-byte key is generated once on the controller and placed by the Ansible role through stdin. It is never logged, never in git, never in the repository, never in a Helm value or a Kubernetes Secret. It is a root-only file on the root filesystem and not on the k3s data volume, so a stolen data volume or Raft snapshot is useless without it.
- **Recovery shares are held off-box by the owner.** The initial recovery keys are issued at first start and kept by the owner, never on the node and never in the repository.
- **Backup and restore need the key.** Losing the key makes even a good snapshot unrecoverable, so the key has an off-box copy held by the owner. The snapshot schedule, target and drill belong to the backup decision.
- **Limit.** A compromise of the host reads both the key and the data. The exception buys unattended recovery and protection against a stolen volume or snapshot, nothing more. It is the same exposure the k3s Secret-encryption key already has.
- **One-way door.** Moving to another seal later needs both seals and downtime. A TPM-backed seal is a later hardening if the host has a TPM, as an expand-contract change to the seal block.
- **`AGENTS.md` names the exception** in its secrets rule, citing this ADR's real number.

## Consequences

- The rule "secrets never touch disk or git in plaintext" has one recorded exception; any other plaintext secret on disk is still a violation.
- The Ansible role gains a task that places the key through stdin without logging it, with a test that the key never appears in a log, a diff or a check-mode output.
- The key's file mode, owner and location are checked after every apply, so a drift fails closed.
- Open for the backup decision: where the owner's off-box copies and the snapshot target live. Until an off-host target exists, a drill is labelled "mechanics proven, not off-host", and an application whose values live only in OpenBao does not go public before an off-host snapshot exists.
