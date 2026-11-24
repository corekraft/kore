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
5. On the agents VM, sign the logins in by hand, as `agent`: `gh auth login`
   and `claude` (see [The agents VM](#the-agents-vm)). They are never backed up.

The whole rebuild, with the restores and what is still planned, is in
[rebuilding the box](../../../docs/operations/rebuild-the-box.md). Hold the
items in the [recovery kit](../../../docs/operations/recovery-kit.md) before you
start.

Without a key, the playbook stops at the sign-in check: run
`sudo tailscale up --ssh --hostname=kore-vps` on the host, approve the link,
and run it again. Public SSH is closed after step 3.

If the tailnet is lost, the provider's
rescue mode is the way back in.

## The agents VM

The `incus` role creates `kore-agents` (an Incus VM on the private bridge
`incusbr0`), and the second play converges it through the host. The VM runs
herdr-core (`hc`), Claude Code, gh, mise, mosh and tmux as the `agent` account,
which has Docker and no sudo. The `agents` role gives it a local mkcert CA in its
home and trusts that CA in the system store, as root, so `kore local up` never
asks for a password; the key stays on the VM. It also adds a `kore-dns` link that
sends only `platform.kore.internal` names to the platform DNS on `127.0.0.1:1053`,
so `kore local up` profiles with `platform-dns` resolve, and installs `lsof`.

With `TAILSCALE_AUTH_KEY` set, the playbook signs the VM in too. Without it,
the run stops at the VM's sign-in check: run
`ssh debian@kore-vps sudo incus exec kore-agents -- tailscale up --hostname=kore-agents`,
approve the link, then `mise run vps-apply` again.

Tailscale SSH is off on the VM (`tailscale_ssh: false`): its own sshd checks
`authorized_keys`, where the playbook puts your public keys. Then as `agent`
(`ssh agent@kore-agents`); none of these secrets enter the repository:

1. `gh auth login` with a fine-grained token limited to `corekraft/kore`.
2. `claude` and sign in.

## Published ports

`port-table.yaml` is the one table of what the host publishes: each public or
tailnet port, the node port it maps to and the Service that owns it. The
`network` role redirects each port to its node port, per address, and drops
every other node port that arrives off the tailnet, except the external
Gateway's. The host's public and tailnet addresses come from the play's facts
(`kore_host_addresses` in `site.yaml`); the `k3s` role publishes them to the
cluster as the `kore-host-addresses` ConfigMap. Neither address is in the
repository, and that task's output is suppressed. All of it sits behind the
`host-published-ports` flag in the vps overlay, off until a live run on kore-vps
and `harness flag activate`; with it off the run writes today's firewall and no
ConfigMap.

## k3s

The `k3s` role runs a single-node k3s on the host for the persistent kore: the
pinned version, the SQLite datastore, Traefik and servicelb disabled, data on
its own volume at `/var/lib/rancher`, and CPU and IO priority over the agents
VM. The API answers on the tailnet only. `mise run vps-apply` writes the
kubeconfig to `~/.kube/kore-vps.yaml` on your machine with the context
`kore-vps`; it is a credential and never enters the repository.

### Trusting the in-cluster registry

k3s pulls from the in-cluster registry (`registry.address` in
`infra/environments/vps/environment.yaml`) over TLS, so its containerd needs
the registry's public CA. The role manages this only while the `k3s-registry-trust`
flag is on in `infra/environments/vps/environment.yaml` (off until a live run
and `harness flag activate`); with it off a run changes nothing here. After
`kore platform up --environment vps` has installed the registry, from your
machine (only the public `ca.crt`, never a key; the file stays outside the
repository; with the flag on and no file the run stops and says so):

```sh
kubectl --context kore-vps -n cosign-system get configmap kore-registry-ca \
  -o jsonpath='{.data.ca\.crt}' > ~/.kube/kore-vps-registry-ca.crt
mise run vps-apply
```

The run installs the CA at `/etc/rancher/k3s/registry-ca.crt`, writes
`/etc/rancher/k3s/registries.yaml`, and restarts k3s once (the pods restart
with it). It refuses a file that holds a private key.

## The OpenBao static seal key

The `openbao` role places the static seal key that OpenBao unseals itself with
after a reboot ([ADR 0168](../../../docs/decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md),
the one recorded exception to no plaintext on disk). It runs last in the play and
does nothing while the `openbao` flag in `infra/environments/vps/environment.yaml`
is off (off until a live run and `harness flag activate`).

The key is base64 text that decodes to 32 bytes. The controller keeps it at
`~/.config/kore/openbao-static-seal.key`, outside the repository, and the role
streams it to the node through stdin, never logged, to
`/etc/kore/openbao/static-seal.key`: a root-only file (mode 0400) on the root
filesystem, not on the k3s data volume. Create the controller copy on a first
placement only; on a rebuild, copy it from the recovery kit instead, because a
new key cannot unseal an OpenBao that holds the old one.

```sh
install -d -m 0700 ~/.config/kore
openssl rand -base64 32 > ~/.config/kore/openbao-static-seal.key
chmod 0400 ~/.config/kore/openbao-static-seal.key
```

A missing or short controller key stops the run and changes nothing. After every
apply the role checks the node's file: mode, owner, group, location and content.
It never overwrites a key that is already there, and a drift stops the run
without a repair.

## OpenBao in the cluster

The platform deploys one OpenBao in the `openbao` namespace behind the same
`openbao` flag, off in every overlay
([ADR 0167](../../../docs/decisions/0167-application-secrets-come-from-openbao-behind-the-platform-secrets-contract-one-path-per-suborg.md)).
It is one replica with Raft storage on the `kore-retained` class, the injector
and CSI sub-charts off, the chart and the image pinned in
`infra/catalog/versions.yaml` with their evidence in `infra/catalog/compatibility.md`.

The pod cannot read the root-only seal key the role placed, because OpenBao runs
as a non-root user. An init container copies it from `/etc/kore/openbao` to a
memory volume owned by that user, and the static seal reads the copy. The copy
never reaches a disk, a Secret or a log.

Self-initialization runs once, on the first start, and enables one file audit
device at `/openbao/audit/audit.log` on its own volume. Nothing else is configured:
no auth method, policy or mount. The audit log has no rotation yet, so the volume
is the limit until the backup decision sets one.

`kore platform up` waits for `statefulset/openbao` with a check that fails closed
and names the cause: `OpenBao is uninitialised`, `OpenBao is sealed`, or
`OpenBao has no audit device`. A Ready pod alone proves none of the three.

The recovery shares do not exist after self-initialization: the root token is
revoked and no share is generated. The owner creates them when the first
authenticated identity exists, with `bao operator rotate-keys -init -target=recovery`
run by the owner in their own terminal, so the shares print once to that terminal.
No script, agent session, CI job or `tee` touches them, and nobody copies them
into a file or a log: the owner moves each share by hand into the recovery kit
([ADR 0168](../../../docs/decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md)).
The single-voter Raft setup through this chart is proven only by the live proof
ticket [#1603](https://github.com/corekraft/kore/issues/1603).
