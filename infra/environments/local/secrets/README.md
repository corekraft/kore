# Local encrypted secrets

Only `*.enc.yaml` SOPS documents belong here. Generate an age key outside the
repository, replace the recipient in `.sops.yaml`, and run the explicit
`tools/secrets/sync-local.sh` operation. Never pass plaintext values through Helm.

