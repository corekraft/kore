# Local secrets

`local up` automatically generates and applies the reference app's API token.
The token persists outside the cluster at `.kore/state/reference-api-token`
with owner-only file permissions, so it survives a local prune and is reused on
the next setup. Keep `.kore/` private and out of backups or shared artifacts.

Optional additional local secrets may be supplied as `*.enc.yaml` SOPS
documents. Never pass plaintext values through Helm.
