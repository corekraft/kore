# Recovery kit

The items the owner holds off the box and off the controller, so that every
backup stays readable and the box can be rebuilt
([glossary](../../GLOSSARY.md#backup-and-recovery),
[ADR 0156](../decisions/0156-the-box-is-rebuilt-from-git-ghcr-and-backups-under-a-recovery-hold.md),
[ADR 0168](../decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md)).

**This page holds no value.** It names each item, who holds it, and where the
owner keeps it. No key, token, share, password, address or domain is written
here or anywhere in the repository. Keep the items in the owner's password
manager or on paper, and nowhere on the box or the controller.

**Status: planned.** The items are needed by the [rebuild](rebuild-the-box.md)
and the restore path, which are not built yet.

## Items

| #   | Item                               | Holder                                                                                                                                                    | Held where                                                   | Used in the rebuild                                                                                   | What losing it costs                                                                                                                                                      |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | vps age identity                   | The controller holds the working copy. The owner holds the kit copy                                                                                       | Password manager or paper, off box and controller            | Steps 8, 10, 11: decrypts the vps sops files and the real-data backups on the controller              | Without it the sops files and backups stay encrypted, and a controller loss leaves no way to restore                                                                      |
| 2   | Recovery age identity              | The owner only                                                                                                                                            | Password manager or paper, off box and controller            | Steps 10, 11: second recipient on every real-data backup                                              | Without it, a controller loss makes every real-data backup unreadable                                                                                                     |
| 3   | OpenBao static seal key            | The owner holds the off-box copy. The box holds a root-only copy after step 7                                                                             | Password manager or paper, off box                           | Step 7: placed by Ansible so OpenBao unseals itself                                                   | Losing it makes even a good OpenBao snapshot unrecoverable ([ADR 0168](../decisions/0168-the-openbao-static-seal-key-is-a-recorded-exception-to-no-plaintext-on-disk.md)) |
| 4   | OpenBao recovery shares            | The owner only, issued at first start                                                                                                                     | Password manager or paper, never on the node                 | Custody. Which shares apply after a restore into a fresh instance is unproven until the rebuild drill | Losing them can block a manual unseal. The owner keeps every set issued until the drill settles it                                                                        |
| 5   | Target credentials                 | The box holds a write-only credential, from sops. The controller holds the read and prune credentials. The owner holds the kit copy of the target's login | Password manager or paper, off box and controller            | Steps 10 to 12: the box writes backups; the controller reads them and prunes retention                | Without the read credential the controller cannot restore; without the prune credential retention needs the target's own rules                                            |
| 6   | Tailscale access                   | The owner only                                                                                                                                            | Password manager or paper, with the account's recovery codes | Step 2: the admin console removes the old machines and makes the one-off key                          | Without it the tailnet cannot be reset, and the host cannot be signed in. The provider's rescue mode is the way back in                                                   |
| 7   | Cloudflare access                  | The owner only                                                                                                                                            | Password manager or paper, with the account's recovery codes | Re-creating or re-issuing the platform zone's records and tokens after a rebuild                      | Without it the zone cannot be changed and certificates cannot be re-issued                                                                                                |
| 8   | GHCR read login (owner to confirm) | The owner only                                                                                                                                            | Password manager or paper, off box and controller            | Step 12: the controller copies images from GHCR by digest                                             | Without it the image copy cannot run. Not in ADR 0156's list; the owner decides whether it joins the kit                                                                  |

## Not kit items

These are regenerated, rebuilt or done by hand, so they are not kept in the kit:

- The kubeconfig: Ansible rewrites it on the controller.
- The OpenTofu state: re-created by import if the controller is lost.
- The in-cluster CA key, the registry credentials and CA, and the Argo CD admin:
  regenerated on install ([ADR 0142](../decisions/0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md)).
- The Tailscale one-off auth key: made at rebuild time and expires within a day.
- The agents VM logins (the gh token and the claude sign-in): done by hand on
  `kore-agents` at step 5 of the [rebuild](rebuild-the-box.md), never backed up.

## Attestation

The rebuild drill ends here. The owner checks that each item in the table can be
retrieved from its holding, and records the check with the drill's live-run
outcome.

- [ ] 1. vps age identity retrieved
- [ ] 2. Recovery age identity retrieved
- [ ] 3. OpenBao static seal key retrieved
- [ ] 4. OpenBao recovery shares retrieved
- [ ] 5. Target credentials retrieved
- [ ] 6. Tailscale access retrieved
- [ ] 7. Cloudflare access retrieved
- [ ] 8. GHCR read login retrieved, or the owner has decided it is not kit

The attestation names each item and the date it was checked. It never records a
value, a share, a password or a domain.
