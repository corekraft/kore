# Rebuilding the box

How to rebuild `kore-vps` and its agents VM from nothing, in order, and what
each step needs. The design is [ADR 0156](../decisions/0156-the-box-is-rebuilt-from-git-ghcr-and-backups-under-a-recovery-hold.md);
the backups it restores from are [ADR 0155](../decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md)
and the operations page [backups](backups.md). The items you must hold before you
start are in the [recovery kit](recovery-kit.md).

**Status: planned.** Most of the restore path is not built yet, and no rebuild
drill has run. Each step says whether it is built or planned. Nothing here is
proven until the rebuild drill is recorded as a live-run outcome.

## What this covers, and what it does not promise

Loss of the whole box is a recoverable disaster, not the "recover without a
hand" promise of an infrastructure event. The provider OS install and the
Tailscale sign-in are by hand, so the rebuild is not hands-free.

- **Objective, whole-box loss: 8 hours**, from the provider OS install to every
  app serving, counting the by-hand steps. The first drills use this ceiling.
  After three drills the objective becomes the slowest measured drill plus 50
  percent, never above 8 hours.
- **Objective, one database restore: 60 minutes.** The first-drill ceiling, on
  the same rule.

Until an off-host target exists, the backups live on the same disks as the box,
and a whole-box loss can take them with it. In that state the rebuild proves the
mechanics only, and every report says "mechanics proven, not off-host". Do not
treat a rebuild as a recovery of real data before the off-host target is in place.

## Legend

- **By hand**: a person does the work in a provider or Tailscale console, in a
  shell, or with a secret. No `kore` or Ansible command does it.
- **Automated**: a command does the work. A person only starts it or checks it.
- **Planned**: the command or step is not built yet. It is named in ADR 0155 or
  ADR 0156. It is marked built here when it lands.

## What comes back, and from where

Each thing on the box has exactly one protection class
([glossary](../../GLOSSARY.md#backup-and-recovery)).

| Class                        | What it covers                                                                                                                                 | How it comes back                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Rebuilt from git             | The Ansible host, Argo applications, Crossplane claims, charts, sops files                                                                     | Automated from the repository (steps 3, 4, 6, 8)                                                                    |
| Rebuilt from elsewhere       | Images, from GHCR by digest. Telemetry is lost on purpose                                                                                      | Images: planned controller copy (step 12). Telemetry: not restored                                                  |
| Regenerated, never backed up | The in-cluster CA key, registry credentials and CA, the Argo CD admin, the k3s datastore and its Secret-encryption key, and every Secret in it | Regenerated on install. The k3s datastore is never restored on a rebuild. The agents VM logins are by hand (step 5) |
| Backed up                    | App databases that opted in, the platform's own databases, the OpenBao snapshot, and the stage ledger copy                                     | Restored from the controller: OpenBao (step 10) and databases (step 11), both planned                               |

The OpenBao static seal key, the recovery shares and the age identities are
custody items, not data. They come from the [recovery kit](recovery-kit.md), not
from a backup.

## The steps, in order

The order is ADR 0156's restore order: the seal key is placed, OpenBao starts
fresh, the snapshot and the databases are restored, the images are copied, and
only then is the hold lifted and apps sync. Run every step from the controller
unless the step says otherwise. The controller is the machine you run `kore`
from; it holds the vps age identity, the kubeconfig and the sops checkout.

| #   | Step                                                                                                                                                                                                                                                                                                                                                                   | Who                                 | Status                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Install Debian 13 on the provider with RAID1 and the layout in the [host README](../../infra/hosts/vps/README.md#rebuilding-from-nothing). Add your SSH public key.                                                                                                                                                                                                    | By hand                             | Manual step (provider console)                                                                                                                                          |
| 2   | In the Tailscale admin console, remove the old `kore-vps` and `kore-agents` machines. Generate a one-off, reusable auth key that expires within a day.                                                                                                                                                                                                                 | By hand                             | Manual step                                                                                                                                                             |
| 3   | Converge the host: `export TAILSCALE_AUTH_KEY=<key>`, then `mise run vps-apply -e ansible_host=<public address> --limit kore-vps`. The playbook signs the host in through stdin, installs base packages, the firewall and sshd hardening, Incus, and k3s (pinned, SQLite datastore), then closes public SSH. Without a key, sign the host in by hand and run it again. | Automated                           | Built                                                                                                                                                                   |
| 4   | Converge the agents VM: `mise run vps-apply`. The `incus` and `agents` roles create `kore-agents` and install its tools. Without a key, sign the VM in with the command in the host README and run it again.                                                                                                                                                           | Automated                           | Built                                                                                                                                                                   |
| 5   | Sign the agents VM logins in, as `agent` on `kore-agents`: `gh auth login` with a fine-grained token limited to the repository, and `claude`. Never backed up.                                                                                                                                                                                                         | By hand                             | Manual step                                                                                                                                                             |
| 6   | Tag the new tailnet machines: `tofu apply` in `infra/tofu/stacks/tailnet`, from the controller's OpenTofu state.                                                                                                                                                                                                                                                       | Automated                           | Built (run by hand)                                                                                                                                                     |
| 7   | Place the OpenBao static seal key. You supply the key from the kit, and the Ansible role writes it root-only through stdin, never logged. The file is not on the k3s data volume.                                                                                                                                                                                      | By hand supply, automated placement | Built behind the `openbao` flag, off until a live run. The `openbao` role places it, see the [host README](../../infra/hosts/vps/README.md#the-openbao-static-seal-key) |
| 8   | Install the platform under the recovery hold: kore platform up --environment vps --recover. It installs the platform and an Argo CD sync window that denies app syncs. It needs `platform-argocd-delivery` active, which the vps overlay has off today. Without `--recover`, `kore platform up --environment vps` installs the platform with no hold.                  | Automated                           | **Planned** (`--recover`)                                                                                                                                               |
| 9   | `mise run vps-apply` installs the registry's public CA for k3s from the cluster: the role reads only `ca.crt` from the registry's Secret, with no by-hand copy. It is gated by the `k3s-registry-trust` flag, off today, and skips until step 8 has deployed the registry.                                                                                             | Automated                           | Built behind a flag                                                                                                                                                     |
| 10  | Restore OpenBao from the newest snapshot on the target, into the freshly initialised instance, before External Secrets resyncs.                                                                                                                                                                                                                                        | Automated                           | **Planned**. Restore into a self-initialised instance is unproven until the rebuild drill                                                                               |
| 11  | Restore each backed-up database from the controller: `kore data restore --environment vps --from <object>`. It decrypts on the controller and streams into the primary. A non-empty database is refused without `--overwrite-data --yes`. A database the owner names empty on purpose is the only other way out of the hold.                                           | Automated                           | **Planned**. `kore data restore` is built for local exports only                                                                                                        |
| 12  | Copy the images by digest from GHCR, through the registry forward with the owner's GHCR read login. The copy covers every digest a current record names, plus the revert targets the retention rule keeps.                                                                                                                                                             | Automated                           | **Planned**                                                                                                                                                             |
| 13  | Lift the hold, only after steps 10 to 12 have finished. Apps sync from git. Each app's PreSync migration then runs against restored data.                                                                                                                                                                                                                              | Automated                           | **Planned**                                                                                                                                                             |
| 14  | Resume delivery: the delivery loop on `kore-agents` resumes and takes over copying digests.                                                                                                                                                                                                                                                                            | Automated                           | Loop built; the copy is **planned**                                                                                                                                     |
| 15  | Check: `kore platform status --environment vps` shows every app serving. The `backups` row for vps reads the freshness record.                                                                                                                                                                                                                                         | Automated                           | Status built; the vps `backups` row is **planned**                                                                                                                      |
| 16  | Attest the recovery kit. The owner confirms each kit item can be retrieved, and records it with the drill's outcome. The attestation names items and dates, never values.                                                                                                                                                                                              | By hand                             | Planned, with the rebuild drill                                                                                                                                         |

Step 9 needs the registry installed, so it follows step 8. Step 12 needs the
registry too, and the k3s registry trust from step 9. Do not start step 13
until steps 10 to 12 have all finished.

## Steps that stay by hand

These steps sit outside what the rebuild drill proves, so they rest on the
owner's own checks:

- The provider OS install (step 1).
- The Tailscale console steps and the auth key (step 2).
- The agents VM logins (step 5).
- Supplying the seal key from the kit (step 7).

The rebuild drill proves steps 3, 4, 6, 8 and 10 to 15 against a rehearsal k3s in
an Incus VM, and ends with the attestation in step 16. It does not run the
provider install or the console steps.

## Drills

Two drills, each recorded as a live-run outcome, gate turning the `database-backups` flag on:

- **Restore drill** (planned). From the controller, restore a real backup from
  the target into a scratch database beside the live one. Check row counts
  against the manifest and measure the time. It repeats quarterly, and once more
  before the first service with data goes public.
- **Rebuild drill** (planned). Run steps 3, 4, 6, 8 and 10 to 15 against a
  rehearsal k3s in an Incus VM, sized by shrinking the agents VM. It ends with the
  attestation in step 16. It runs again after a change to the host roles or the
  backup path.

## Commands

| Command                                                        | Status                                             |
| -------------------------------------------------------------- | -------------------------------------------------- |
| `kore platform up --environment vps`                           | Built. It installs the platform without a hold     |
| kore platform up --environment vps --recover                   | **Planned**. Installs under the recovery hold      |
| `kore platform status --environment vps`                       | Built. The vps `backups` row is **planned**        |
| `kore data restore --environment vps --from <object>`          | **Planned**. Built for local exports only          |
| kore data backup --environment vps, optionally for one service | **Planned**                                        |
| `kore data export --environment <name>`                        | Built. A manual extra copy that counts for no gate |
| The OpenBao snapshot restore (step 10)                         | **Planned**                                        |
| The controller's image copy (step 12)                          | **Planned**. Part of `--recover`                   |
| Lifting the hold (step 13)                                     | **Planned**. Part of `--recover`                   |

## Not in the rebuild

These are not restored, on purpose:

- **Cluster state**: the k3s datastore, its encryption key and its Secrets. They
  are derivable from git, from a fresh CloudNativePG cluster that regenerates its
  role Secrets, and from External Secrets re-reading OpenBao. A datastore copy
  taken before a k3s upgrade is a local rollback aid, never restored on a rebuild.
- **Images as backups.** GHCR is the origin, so there is no off-host registry backup.
- **Telemetry.** Lost on purpose.
- **Cluster-generated keys and credentials.** Regenerated, never backed up, so the
  CA key never leaves the cluster.
- **Controller loss.** Out of scope beyond the [recovery kit](recovery-kit.md).
  The kubeconfig is rewritten by Ansible, the age identity comes from the kit,
  and the OpenTofu state is re-created by import.

## Related

- [Recovery kit](recovery-kit.md): what to hold, who holds it, and the attestation.
- [Backups and recovery point objective](backups.md): the vps backup targets and the freshness record.
- [Registry](registry.md): the registry as a cache, and its vps section.
- [VPS host](../../infra/hosts/vps/README.md): the by-hand steps for the host and the agents VM.
- ADR [0141](../decisions/0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md), [0143](../decisions/0143-the-controller-reaches-a-managed-registry-through-a-forward-over-the-tailnet.md), [0155](../decisions/0155-retained-databases-are-backed-up-by-a-scheduled-age-encrypted-dump-and-restored-only-from-the-controller.md), [0156](../decisions/0156-the-box-is-rebuilt-from-git-ghcr-and-backups-under-a-recovery-hold.md), [0168](../decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md).
