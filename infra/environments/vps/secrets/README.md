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

## Cloudflare token documents

Each consumer of a Cloudflare token has its own document, so a revoked token
fails one consumer and not both. The owner makes each token by hand in
Cloudflare, with Zone Read and DNS Edit on the one platform zone and a 12-month
expiry, then stores it through sops:

| Document                           | Consumer     | Flag           | Namespace           |
| ---------------------------------- | ------------ | -------------- | ------------------- |
| `cloudflare-external-dns.enc.yaml` | external-dns | `external-dns` | `kore-external-dns` |
| `cloudflare-acme-dns01.enc.yaml`   | cert-manager | `acme-dns01`   | `cert-manager`      |

Each document is a Kubernetes Secret manifest whose value sits under
`stringData`, encrypted by sops like the rest:

    apiVersion: v1
    kind: Secret
    metadata:
      name: cloudflare-token
      namespace: kore-external-dns
    type: Opaque
    stringData:
      api-token: <the token made in Cloudflare>

`kore secrets tokens --environment vps` decrypts each document whose flag is on
and streams the value to kubectl on stdin, so no plaintext touches disk or an
argument. A flag that is off applies nothing. A missing or undecryptable
document, or one that names another namespace, stops the run before the cluster
is touched and names the document and the fix.

Rotation is replacing the document with `sops`, then running
`kore secrets tokens --environment vps` again. The Secret's
`platform.kore.dev/document-sha256` annotation changes with the document, and an
unchanged document applies nothing new. The consumer pod rolls on rotation only
once its chart carries that checksum in its pod template.

## Backup credential documents

The backup target declares `credentials.secret` (for example `backup-write`).
Three documents hold its S3 access keys, each a Kubernetes Secret manifest with
`stringData.AWS_ACCESS_KEY_ID` and `stringData.AWS_SECRET_ACCESS_KEY`, encrypted
by sops like the rest:

| Document                                                  | Held by                   | Applied to the cluster?                                 |
| --------------------------------------------------------- | ------------------------- | ------------------------------------------------------- |
| `secrets/<credentials.secret>.enc.yaml`                   | the backup job            | yes, by `kore secrets backup` (flag `database-backups`) |
| `controller-secrets/<credentials.secret>-read.enc.yaml`   | the controller, to list   | never                                                   |
| `controller-secrets/<credentials.secret>-delete.enc.yaml` | the controller, to delete | never                                                   |

The write-only document is the only one under `secrets/`, so no sync reaches the
read or delete keys. Only `kore backup prune` decrypts the controller documents,
in memory, and only after consent. Each Secret's `metadata.name` must match its
file's name. The write-only Secret's `metadata.namespace` names the namespace the
job runs in.
