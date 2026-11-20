# Local secrets

`local up` automatically generates and applies the reference app's API token.
The token persists outside the cluster at `.kore/state/environments/<environment>/reference-api-token`
with owner-only file permissions, so it survives a local prune and is reused on
the next setup. Keep `.kore/` private and out of backups or shared artifacts.

Optional additional local secrets may be supplied as `*.enc.yaml` SOPS
documents. Never pass plaintext values through Helm.

Local documents are encrypted to the local age recipients in `.sops.yaml`, which
are separate from any managed environment's. Each machine that runs
`kore local up` keeps its own age identity, and that machine's public
recipient is listed in the local rule as a comma-separated entry. No private
key is shared between machines. A document is decryptable by each listed
machine, and `kore local export` encrypts to every listed recipient. To add a
machine, generate its identity there with `age-keygen`, add its public key to
the local rule, and re-encrypt the documents with `sops updatekeys`. Remove a
machine by taking its entry out of the rule and running `sops updatekeys`
again. The identity stays on the machine that owns it. On macOS, sops looks for it under
`~/Library/Application Support/sops/age/keys.txt` unless `SOPS_AGE_KEY_FILE` or
`XDG_CONFIG_HOME` says otherwise, so export
`SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt` if the key lives there.
`sops-canary.enc.yaml` holds no real secret; it proves the encrypted path on
every `local up`. Create or change documents only through `sops`:

    sops infra/environments/local/secrets/<name>.enc.yaml
