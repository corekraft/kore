# VPS secrets

Documents here are encrypted only to this environment's own age recipient,
written in `.sops.yaml` beside local's and never shared with it. The matching
identity stays on the owner's controller at
`~/.config/sops/age/kore-vps.txt`, outside the repository. There is no
encrypted document yet.

## Recreating the key

1. Create the key outside the repository. `age-keygen` writes it with
   owner-only permissions and prints the public recipient (`age1...`):

       mise exec -- age-keygen -o "$HOME/.config/sops/age/kore-vps.txt"

2. Keep the private key out of git, out of backups that leave the machine, and
   out of every shared artifact. Only the public recipient goes into the repo.
3. Replace this environment's recipient in `.sops.yaml` with the new public
   recipient, and re-encrypt every document here with `sops updatekeys`.
4. Point sops at the private key when you encrypt or decrypt here:

       export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/kore-vps.txt"

5. Create documents only through `sops`, never by hand:

       mise exec -- sops infra/environments/vps/secrets/<name>.enc.yaml

`kore` reads the public recipient from `.sops.yaml` (`exportRecipient`) and
never reads the private key.
