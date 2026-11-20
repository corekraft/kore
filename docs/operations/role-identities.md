# Role identities on a Linux delivery host

Where the role identities live on each host, and how to fill a Linux host's store
([ADR 0096](../decisions/0096-role-tokens-reach-panes-through-a-fifo-handoff.md),
[ADR 0122](../decisions/0122-writer-panes-act-as-the-owner-and-the-judge-is-an-app.md)).

## Where each host keeps them

With `role-tokens` on, `harness session spawn` reads a role's identity before it
splits a pane: each GitHub App's `app-id`, `installation-id` and `private-key`
(`kore.<role>.*`, roles `writer`, `reviewer`, `orchestrator`, `judge`), and the
machine-user PAT `kore.judge.pat`.

| Host  | Store                                                                                                           | Read with                                           |
| ----- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| macOS | the login keychain, account `kore`                                                                              | `security find-generic-password`                    |
| Linux | `~/.config/kore/identities.sops.json`, sops-encrypted to the host's own age key (`~/.config/sops/age/keys.txt`) | `sops decrypt --extract '["<item>"]'`, one per call |

The item names are the same on both. The Linux read goes through the harness's
runner, one key per call, so a value is never written to disk, put in argv or
logged. An error names the missing item and the step that fixes it, never a
value.

## Fill a Linux host's store

Prerequisite: the host has `sops` and `age`, and an age key. On the host:

```bash
age-keygen -o ~/.config/sops/age/keys.txt
```

Then, from the Mac that holds the keychain items (after `bash
tools/harness/wizards/identities.sh` has created them):

```bash
bash tools/harness/wizards/identities.sh --transfer agent@kore-agents --dry-run
bash tools/harness/wizards/identities.sh --transfer agent@kore-agents
```

The transfer reads each item from the keychain into the wizard's memory, asks the
host for its age public key (`age-keygen -y`, public only), and streams the values
over `ssh` on stdin into `sops encrypt` on the host. Plaintext touches neither
disk and no command line. The host's file is replaced whole, written `0600`
through a temporary name, so a failed run leaves the old file. Rerun it after
rotating any item on the Mac.

An item the keychain lacks is skipped and named. A value outside letters, digits
and `_+/=.:-` is refused, without printing it.

## Check it

On the host, `harness review run <pr>` spawns a reviewer with its minted token.
If it stops, the error says which of three things is wrong: the store file is
missing (run the transfer), an item is absent from it (run the transfer after the
wizard created the item), or sops could not decrypt it (the host's age key is not
the one the file was encrypted to; run the transfer again).
