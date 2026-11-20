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

## The agents VM

The `incus` role creates `kore-agents` (an Incus VM on the private bridge
`incusbr0`), and the second play converges it through the host. The VM runs
herdr, Claude Code, gh, mise, mosh, tmux and moshi-hook as the `agent` account,
which has Docker and no sudo.

Once, after the first `mise run vps-apply` stops at the VM's sign-in check:

1. `ssh debian@kore-vps sudo incus exec kore-agents -- tailscale up --ssh --hostname=kore-agents`
   and approve the link, then `mise run vps-apply` again.

Tailscale SSH is off on the VM (`tailscale_ssh: false`): its own sshd checks
`authorized_keys`, where the playbook puts your public keys and Moshi puts the
phone's. Then as `agent` (`ssh agent@kore-agents`); none of these secrets enter
the repository:

1. `gh auth login` with a fine-grained token limited to `corekraft/kore`.
2. `claude` and sign in.
3. Moshi: `ssh -t agent@kore-agents moshi-hook host setup` and scan the QR in
   the app (it is a temporary access token). The playbook already runs the
   moshi-hook daemon and adds its Claude Code hooks; `moshi-hook doctor` should
   show every feature ready.
