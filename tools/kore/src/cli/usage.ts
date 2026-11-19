export const usage = `Kore local platform orchestration

Usage:
  kore doctor [--environment local] [--json]
  kore validate [--environment local] [--platform-image-lock <file>] [--platform-claims <file>] [--json]   (warnings print as "warning:" lines on stderr and in --json as warnings; they never change the exit status; environment exemptionCheck: audit|enforce, unset reads as audit; --platform-claims checks a JSON array of Organization and Service claims against their schema, offline, and is skipped with a warning while the platform-organization-service-apis flag is off)
  kore status [--environment local] [--json]   (reports each Organization and Service claim's Ready condition, read-only; exits 1 while one is not ready; reports gated-off, without reading the cluster, while the platform-organization-service-apis flag is off)
  kore cluster up|stop|destroy --environment <name> [--yes] [--purge-data]
  kore cluster status [--environment <name>] [--json]
  kore platform bootstrap|up|gate-check|stop|destroy --environment <name> [--yes] [--purge-data] [--force] [--platform-chart-lock <platform-charts.lock.json>] [--platform-template-lock <template-images.lock.json>]   (the locks are read only by "up", and only while platform-argocd-delivery is on, when it is required: kore checks it against the catalog before touching the cluster, composes the kore-config-delivery chart values from the chart lock, the kore-golden-path-delivery values from the template lock, the checked-out commit and the environment, and gives Argo CD the registry's read credential through stdin)
  kore platform status|render [--environment <name>] [--output <directory>] [--json]   (a component gated off by its catalog featureFlag reports gated-off)
  kore app up <name> --environment <name> [--image-lock <release images.lock.json>]
  kore app down <name> --environment <name> [--json]
  kore app status <name> [--environment <name>] [--json]   (reports degraded when the registry or verifier is down)
  kore data export --environment <name> [--namespace reference] [--json]
  kore data restore --environment <name> --from <file> [--identity <age-key-file>] [--overwrite-data --yes] [--json]
  kore local up|down --environment local [--prune [--purge-data]] [--force] [--platform-chart-lock <platform-charts.lock.json>] [--platform-template-lock <template-images.lock.json>]   (the locks are read only by "up", and only while platform-argocd-delivery is on, when both are required; see "kore platform")
  kore registry rotate-credentials --environment <name> --yes [--json]
  kore signer swap-key --environment local --yes [--json]
  kore secrets sync --environment local [--rotate --yes]
  kore secrets smtp --environment <name>   (streams {"user": "...", "password": "..."} on stdin into the grafana-smtp Secret that the alert email settings read; run it after the platform is up; the login is never read from a flag, file or config)
  kore trust install --environment local
  kore dns install|uninstall --environment local [--yes] [--json]
  kore journal [--environment <name>] [--limit <n>] [--json]
  kore ops inventory|recovery [--environment local] [--json]
  kore ops upgrade-check|crd-check [--from <release-tag>] [--environment local] [--json]
  kore policy record <constraint> --environment <name> --audit <file|-> [--json]
  kore policy promote|rollback <constraint> --environment <name> [--json]

"cluster destroy" refuses while data labeled platform.kore.dev/retention=Retain
(databases) exists; --purge-data deletes it.

"platform stop|destroy" and "local down" leave the local registry port-forward
running when another worktree, or another kore process in this one, started it;
--force stops it anyway.

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

"app up" deploys only an image that release automation produced: the lock entry's
signer must be a release workflow at a version tag, and cosign verifies that
exact identity before Helm runs. Pass the images.lock.json attached to the
release with --image-lock. A source build runs through "kore local up". Before
installing it clears a failed or canceled earlier attempt (a release that never
deployed is uninstalled, a canceled upgrade is rolled back) and refuses to
uninstall a release whose claim holds retained data.

A mutation queued behind another on the same cluster prints one line naming the
holder's pid, worktree and lock path, then waits ten minutes; "local up" waits
thirty, because a first-time "up" takes 15 to 20. KORE_LOCK_WAIT_MS (whole
milliseconds) overrides both, and a wait that runs out is refused naming the holder.

Before "local up" creates a cluster it checks that each host port the overlay
publishes is free on its loopback address. A taken port is refused before
anything is written or created; the message names the port, the overlay setting
that publishes it, and the process holding it when lsof can tell. A port the
overlay declares "optional": true is not checked.

"app down" uninstalls only the workload release and reports the retained data
(claims and volumes) that remains; with --json it always prints
{ name, retained: [...], warnings? }.

"registry rotate-credentials" replaces the internal registry's push and read
passwords and every enrolled namespace's kore-registry-read pull Secret.
Admission keeps reading signatures throughout (the proxy accepts the old and new
read identity until the pull Secrets are replaced); afterwards the old
passwords get 401. It prints no secret, requires --yes, and is safe to rerun
after a failure.

"signer swap-key" replaces the local cosign key pair and republishes only the
public key to Policy Controller. Images signed with the old key are denied
afterwards until they are signed again (kore app up signs again); the old key is
never trusted alongside the new one. Local key authority only; a managed
environment refuses. It requires --yes and is safe to rerun after a failure.

"trust install" runs "mkcert -install" (which may prompt for your password)
only when the mkcert CA is not already trusted on the host; on macOS it skips
the install when the CA files exist and "security verify-cert" accepts the
root, and on other hosts it always runs it.

"dns install" writes one file, /etc/resolver/<platform domain>, which points that
zone at the platform DNS on loopback (ADR 0132). It shows the file, then runs
"sudo mkdir -p /etc/resolver" and "sudo tee" for it after you confirm, or at once
with --yes; without a terminal it needs --yes. The file starts with a Kore
marker. It is unchanged when already current, and a file without the marker is
never overwritten. "dns uninstall" runs "sudo rm -f" on that file only when it
carries the marker, after the same confirmation. Undo either with the other.

With the platform-dns flag on, "local up" runs the same install first when the
file is missing or out of date, asking on the terminal before any "sudo" and
failing fast, naming the cause, when you decline. A correct file is left alone
and asks nothing. Without a terminal it asks nothing, finishes the cluster, and
prints the next step ("kore dns install") last; "kore doctor" also reports the
file. A file without the marker is reported and never rewritten. With the flag
off "local up" does not look at the file.

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

"policy" edits Gatekeeper constraints in the repository and never touches a
cluster; "kore platform up" applies the change. "record" stores the timestamp
and violation count from "kubectl get <kind>.constraints.gatekeeper.sh <name>
--output json" (a file, or - for stdin) as the environment's promotion evidence
in infra/policies/gatekeeper/promotions/<constraint>.json. "promote" moves one
dryrun constraint to deny only when that evidence shows zero violations and is
under 14 days old. "rollback" sets one constraint back to dryrun and keeps its
evidence. Review the resulting diff in a pull request.

Every mutation requires --environment and is recorded in
.kore/state/journal/<environment>.jsonl. Status, doctor, validate, render, ops,
and journal are read-only and default to local.`;
