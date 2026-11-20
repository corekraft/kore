# VPS host

Desired state for the rented VPS host `kore-vps`, converged by Ansible
([ADR 0141](../../../docs/decisions/0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md)).

## Rebuilding from nothing

1. In the provider's control panel, install Debian 13 with software RAID1, a
   1 GiB `/boot`, an 80 GiB `/` on the LVM volume `root`, 4 GiB swap per disk,
   the rest of the volume group left free, and your SSH public key.
2. On the host: install Tailscale (or run `mise run vps-apply` once over the
   public address, which stops at the sign-in check), then
   `sudo tailscale up --ssh --hostname=kore-vps` and approve the link it prints.
3. From your machine: `mise run vps-check` to see the diff, then
   `mise run vps-apply`.

Public SSH is closed after step 3. If the tailnet is lost, the provider's
rescue mode is the way back in.
