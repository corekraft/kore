# VPS host

Desired state for the rented VPS host `kore-vps`, converged by Ansible
([ADR 0141](../../../docs/decisions/0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md)).

## Rebuilding from nothing

1. In the provider's control panel, install Debian 13 with software RAID1, a
   1 GiB `/boot`, an 80 GiB `/` on the LVM volume `root`, 4 GiB swap per disk,
   the rest of the volume group left free, and your SSH public key.
2. In the Tailscale admin console, remove the old `kore-vps` and `kore-agents`
   machines so the new ones keep those names, and generate a one-off auth key
   (reusable, so it signs in both machines, and expiring within a day).
3. From your machine, with the key only in your shell:
   `export TAILSCALE_AUTH_KEY=<key>`, then
   `mise run vps-apply -e ansible_host=<public address> --limit kore-vps`.
   The playbook signs the host in through stdin and closes public SSH. Then
   `mise run vps-apply` for the agents VM, and `unset TAILSCALE_AUTH_KEY`.
4. `tofu apply` in `infra/tofu/stacks/tailnet` tags the new machines.

Without a key, the playbook stops at the sign-in check: run
`sudo tailscale up --ssh --hostname=kore-vps` on the host, approve the link,
and run it again. Public SSH is closed after step 3.

If the tailnet is lost, the provider's
rescue mode is the way back in.

## The agents VM

The `incus` role creates `kore-agents` (an Incus VM on the private bridge
`incusbr0`), and the second play converges it through the host. The VM runs
herdr, Claude Code, gh, mise, mosh, tmux and moshi-hook as the `agent` account,
which has Docker and no sudo.

With `TAILSCALE_AUTH_KEY` set, the playbook signs the VM in too. Without it,
the run stops at the VM's sign-in check: run
`ssh debian@kore-vps sudo incus exec kore-agents -- tailscale up --hostname=kore-agents`,
approve the link, then `mise run vps-apply` again.

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

## k3s

The `k3s` role runs a single-node k3s on the host for the persistent kore: the
pinned version, the SQLite datastore, Traefik and servicelb disabled, data on
its own volume at `/var/lib/rancher`, and CPU and IO priority over the agents
VM. The API answers on the tailnet only. `mise run vps-apply` writes the
kubeconfig to `~/.kube/kore-vps.yaml` on your machine with the context
`kore-vps`; it is a credential and never enters the repository.
