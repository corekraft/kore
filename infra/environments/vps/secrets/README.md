# VPS secrets

This environment has no encrypted document yet, and its SOPS rule is not
written. A `*.enc.yaml` document is encrypted only to this environment's own
age recipient, never to local's, so the rule waits until the owner creates that
recipient. Until then `sops` refuses to encrypt here, which fails closed.

## Owner steps (once, on the controller)

1. Create the key outside the repository. `age-keygen` writes it with
   owner-only permissions and prints the public recipient (`age1...`):

       mise exec -- age-keygen -o "$HOME/.config/sops/age/kore-vps.txt"

2. Keep the private key out of git, out of backups that leave the machine, and
   out of every shared artifact. Only the public recipient goes into the repo.
3. Add a creation rule to `.sops.yaml` for this environment, beside local's rule,
   with the public recipient from step 1:

       - path_regex: infra/environments/vps/secrets/.*\.enc\.yaml$
         encrypted_regex: '^(data|stringData)$'
         age: age1...   # the public recipient from step 1

4. Point sops at the private key when you encrypt or decrypt here:

       export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/kore-vps.txt"

5. Create documents only through `sops`, never by hand:

       mise exec -- sops infra/environments/vps/secrets/<name>.enc.yaml

`kore` reads the public recipient from `.sops.yaml` (`exportRecipient`) and
never reads the private key.
