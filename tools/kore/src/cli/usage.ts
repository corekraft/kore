export const usage = `Kore local platform orchestration

Usage:
  kore doctor [--environment local] [--json]
  kore validate [--environment local] [--platform-image-lock <file>] [--json]
  kore cluster up|stop|destroy --environment <name> [--yes] [--purge-data]
  kore cluster status [--environment <name>] [--json]
  kore platform bootstrap|up|gate-check|stop|destroy --environment <name> [--yes] [--purge-data]
  kore platform status|render [--environment <name>] [--output <directory>] [--json]
  kore app up <name> --environment <name>
  kore app down <name> --environment <name> [--json]
  kore app status <name> [--environment <name>] [--json]   (reports degraded when the registry or verifier is down)
  kore data export --environment <name> [--namespace reference] [--json]
  kore data restore --environment <name> --from <file> [--identity <age-key-file>] [--overwrite-data --yes] [--json]
  kore local up|down --environment local [--prune [--purge-data]]
  kore tunnel start|stop --environment local
  kore tunnel status [--environment local] [--json]
  kore registry rotate-credentials --environment <name> --yes [--json]
  kore secrets sync --environment local
  kore trust install --environment local
  kore journal [--environment <name>] [--limit <n>] [--json]
  kore ops inventory|recovery [--environment local] [--json]
  kore ops upgrade-check|crd-check [--from <release-tag>] [--environment local] [--json]

"cluster destroy" refuses while data labeled platform.kore.dev/retention=Retain
(databases) exists; --purge-data deletes it.

"data export" dumps each retained CloudNativePG database with pg_dump in the
primary, encrypts the stream with age to the recipient that .sops.yaml names for
the environment, and writes only ciphertext plus a manifest (digest, contents,
environment, time) to .kore/exports/<environment>/. It refuses while the
recipient is the placeholder, and while retained volumes exist that the dump
does not cover. "cluster destroy" accepts an unreachable profile only when such
an export still matches its manifest.

"data restore" loads an export into the matching cluster of a fresh profile. It
verifies the digest, decrypts with "age --decrypt --identity" (--identity or
SOPS_AGE_KEY_FILE; Kore never reads the key), and refuses a database that
already holds tables unless --overwrite-data --yes replaces it.

"app down" uninstalls only the workload release and reports the retained data
(claims and volumes) that remains; with --json it always prints
{ name, retained: [...], warnings? }.

"registry rotate-credentials" replaces the internal registry's push and read
passwords and every enrolled namespace's kore-registry-read pull Secret.
Admission keeps reading signatures throughout (the proxy accepts the old and new
read identity until the pull Secrets are replaced); afterwards the old
passwords get 401. It prints no secret, requires --yes, and is safe to rerun
after a failure.

"trust install" runs "mkcert -install" (which may prompt for your password)
only when the mkcert CA is not already trusted on the host; on macOS it skips
the install when the CA files exist and "security verify-cert" accepts the
root, and on other hosts it always runs it.

"ops" is read-only and offline. "inventory" lists every pinned tool, component,
image, npm package, and GitHub Action, and fails on a range, a missing digest or
integrity hash, or a tag-pinned Action. "recovery" checks
infra/catalog/recovery.yaml: every stateful component needs a recovery objective
and an export objective needs a restore test. "upgrade-check" compares the
catalog at a release tag (default: the newest v* tag, read with git show) with
this checkout and fails on a downgrade, a skipped Kubernetes minor, a removed
CRD owner, or an application contract change that breaks existing claims.
"crd-check" renders each changed chart's CRDs at both versions (helm template,
no cluster) and fails on a removed CRD, a dropped stored version, an unsafe
storage-version move, or a rollback that cannot read the new version.

Every mutation requires --environment and is recorded in
.kore/state/journal/<environment>.jsonl. Status, doctor, validate, render, ops,
and journal are read-only and default to local.`;
