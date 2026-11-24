export const usage = `Kore local platform orchestration

Usage:
  kore doctor [--environment local] [--json]   (read-only; reports whether the platform domain is the placeholder or set, never its value, and the run-time values the flags that are on need, read from the environment and then ~/.kore/runtime.env, which must be owner-only)
  kore validate [--environment local] [--platform-image-lock <file>] [--platform-claims <file>] [--record-base <ref>] [--json]   (warnings print as "warning:" lines on stderr and in --json as warnings; they never change the exit status; environment exemptionCheck: audit|enforce, unset reads as audit; --platform-claims checks a JSON array of Organization and Service claims against their schema, offline, and is skipped with a warning while the platform-organization-service-apis flag is off; the app records of the environment (infra/environments/<env>/services/<service>.json and <service>.release.json) are checked against the Service schema of the platform-apis chart (read with yq) and the ServiceRelease schema, and an existing service's organization is compared with --record-base, default origin/main, which is skipped with a warning when it does not resolve; the suborgs of the environment (infra/environments/<env>/organizations/<suborg>.json) are checked against the Organization rules: one level below platform, a required quota, a name that is not reserved, and each suborg's default zone <suborg>.<platform domain> is reported in --json as organizations, and while platform-hostname-ownership is on each suborg must state its internal zone as <suborg>.<internal domain> (spec #1612); the cross-file rules over those records refuse a service whose suborg is not declared, a grant that is not <suborg>/<service> naming an existing service other than the service itself, requests over the suborg quota, and suborg quotas over the environment's committed capacity, and warn when that capacity cannot be judged)
  kore status [--environment local] [--json]   (reports each Organization and Service claim's Ready condition, read-only; exits 1 while one is not ready; reports gated-off, without reading the cluster, while the platform-organization-service-apis flag is off)
  kore cluster up|stop|destroy --environment <name> [--yes] [--purge-data]
  kore cluster status [--environment <name>] [--json]
  kore platform bootstrap|up|gate-check|stop|destroy --environment <name> [--yes] [--purge-data] [--force] [--platform-chart-lock <platform-charts.lock.json>] [--platform-template-lock <template-images.lock.json>]   (the locks are read only by "up", and only while platform-argocd-delivery is on, when it is required: kore checks it against the catalog before touching the cluster, composes the kore-config-delivery chart values from the chart lock, the kore-golden-path-delivery values from the template lock, the checked-out commit and the environment, and gives Argo CD the registry's read credential through stdin; with release-recovery-argocd-refusal on, a canceled upgrade of a release Argo CD owns is refused, naming its git revert, because helm rollback never runs under Argo CD; off, it rolls back as before; a managed environment refuses any lock the release did not sign, a main chart lock for one, with or without the flag)
  kore platform uninstall <component> --environment <name> [--yes] [--purge-data]   (uninstalls the Helm release of a component whose featureFlag is off, in the environment's configured context; without --yes it removes nothing and names what it would remove; retained data in its namespace needs --purge-data, and a namespace shared with another component is refused; it never prunes and never touches another release)
  kore platform status|render [--environment <name>] [--output <directory>] [--json]   (a component gated off by its catalog featureFlag reports gated-off)
  kore app up <name> --environment <name> [--image-lock <release images.lock.json>]
  kore app down <name> --environment <name> [--json]
  kore app status <name> [--environment <name>] [--json]   (reports degraded when the registry or verifier is down)
  kore data export --environment <name> [--namespace reference] [--json]
  kore data restore --environment <name> --from <file> [--identity <age-key-file>] [--overwrite-data --yes] [--json]
  kore local lock-check --platform-chart-lock <platform-charts.lock.json> [--json]   (read-only: packages the checkout's charts offline with the release script, prints one row per handed-over release as name, repository, lock and drift plus a verdict that names each drifted chart and the fix, and exits 1 on any drift; run it before every live proof)
  kore local fetch-lock --output <platform-charts.lock.json> [--commit <sha>] [--json]   (read-only: downloads the charts-main artifact of a commit, the checkout's HEAD by default, with gh, and writes its main chart lock to --output for --platform-chart-lock; the artifact is kept 30 days, and the command names the cause and the fix when it has expired or is missing or gh is not signed in; it touches no cluster, and --require-fresh-lock still gates the proof)
  kore local up|down --environment local [--prune [--purge-data]] [--force] [--require-fresh-lock] [--platform-chart-lock <platform-charts.lock.json>] [--platform-template-lock <template-images.lock.json>]   (the locks are read only by "up", and only while platform-argocd-delivery is on, when both are required; "up" also packages the checkout's charts offline and warns when a chart version in the chart lock differs from the checkout's; --require-fresh-lock turns that warning into a refusal before any cluster work, for a proof; see "kore platform")
  kore registry rotate-credentials --environment <name> --yes [--json]
  kore signer swap-key --environment local --yes [--json]
  kore secrets sync --environment local [--rotate --yes]
  kore secrets smtp --environment <name>   (streams {"user": "...", "password": "..."} on stdin into the grafana-smtp Secret that the alert email settings read; run it after the platform is up; the login is never read from a flag, file or config)
  kore secrets tokens --environment <name>   (applies the cloudflare-token Secret of each consumer whose flag is on, external-dns or acme-dns01: sops decrypts its document under infra/environments/<name>/secrets and the value is streamed on kubectl's stdin; a flag that is off applies nothing, and a local environment applies nothing)
  kore trust install --environment local
  kore dns install|uninstall --environment local [--yes] [--json]
  kore journal [--environment <name>] [--limit <n>] [--json]
  kore ops inventory|recovery [--environment local] [--json]
  kore ops upgrade-check|crd-check [--from <release-tag>] [--environment local] [--json]
  kore policy record <constraint> --environment <name> --audit <file|-> [--json]
  kore policy promote|rollback <constraint> --environment <name> [--json]
  kore eval <dir> --base <ref> --version <semver>+<sha> --digest sha256:<hex> [--published <file>] [--today <YYYY-MM-DD>] [--carries-plan --n1-apply <exe> --n1-previous-suite <exe>]   (runs the deterministic evals on one application repository and prints a JSON report; exits 1 on a failing verdict; see "eval" below)

"cluster destroy" refuses while data labeled platform.kore.dev/retention=Retain
(databases) exists; --purge-data deletes it.

"platform stop|destroy" and "local down" leave a registry port-forward running when
another worktree, or another kore process in this one, started it; --force stops
it anyway. A k3d environment starts none: it reaches the registry by name.

"data export" dumps each retained CloudNativePG database with pg_dump in the
primary, encrypts the stream with age to every recipient that .sops.yaml names for
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

"eval" checks one candidate of an application in its own repository, with git
and no network. It reads flags.yaml at the app root, the Safety-pattern trailer
of the head commit, the files changed from --base to HEAD, and --published (a
JSON object of version to digest). It refuses a flags.yaml that is not
schema-valid: a service-prefixed flag name, default false, an owner, a safety
pattern of no-behaviour-change, feature-flagged, dark-launched or
expand-contract, an expiry date as YYYY-MM-DD, and a complete rollout (kind flag,
canary or dark-launch; criteria; soakHours of at least 1). It refuses a pattern
the diff contradicts: a migration under migrations/ forces expand-contract, a new
flag forces feature-flagged, and only tests and docs may claim no-behaviour-change.
It refuses a version already published for another digest. A flag past its
expiry only warns and never fails. --version is the manifest semver plus the
commit SHA; --digest is the candidate image's sha256.

The migration checks run only for the image that carries the plan, given
--carries-plan; every other image attests the empty plan and reads no migration.
A migration is a .sql file under migrations/, one migration per file, and is
expand only when every statement is on the allowlist: CREATE TABLE, ALTER TABLE
ADD COLUMN that is nullable or has a default, ALTER TABLE ADD CONSTRAINT NOT
VALID, and CREATE INDEX CONCURRENTLY that is not unique. Any other statement,
any unreadable file and any non-.sql file is a contract. Migrations are
append-only: a modified, renamed or deleted file under migrations/ is refused.
A normal release carries only expand migrations. A contract ships alone, named
by git trailers on the head commit, beside Safety-pattern (which it must set to
expand-contract): Contract-release: data or code, Contract-last-used:
<semver>+<sha> (an earlier release) and Contract-soak-hours: a positive number
of hours. A data contract carries contract migrations only and touches nothing
but migrations/ and tests, so flags.yaml is unchanged; a code contract touches
no migration, retires at least one flag the base manifest declares, and adds
none. The eval checks the trailers' shape only; the platform checks the soak.
A release that adds a migration runs the N-1 check: --n1-apply names an
executable that applies the new migrations, and --n1-previous-suite names one
that runs the previous release's suite; both run in the app directory with
DATABASE_URL set to the scratch database URL, which is read from
KORE_EVAL_SCRATCH_DATABASE_URL, never from argv, and is redacted from every
failure. The caller provisions and drops the scratch database; the eval creates
and destroys nothing. Missing N-1 inputs fail the release and name the three.

The report is JSON: verdict (pass or fail), failures, warnings, and on a pass
only attestations, three in-toto v1 statements whose subject is the image digest
(name: the version, digest.sha256: the hex without the prefix):
  - predicateType urn:kore:eval-result:v1, predicate {verdict, version,
    safetyPattern, checks, warnings, expiredFlags}
  - predicateType urn:kore:flags-manifest:v1, predicate {service, flags}, where
    each flag is {name, default: false, owner, safetyPattern, expiry, rollout:
    {kind, criteria, soakHours}}
  - predicateType urn:kore:migration-plan:v1, predicate {release, migrationsPath,
    migrations, contract, n1}, where release is none, expand, data-contract or
    code-contract; migrationsPath is migrations/ or null (null for none);
    migrations is [{path, class}] sorted by path, class expand or contract;
    contract is null or {lastUsed, soakHours, retiredFlags}; n1 is passed or
    not-applicable
A failing eval prints no attestations, so there is no payload to sign.

Every mutation requires --environment and is recorded in
.kore/state/journal/<environment>.jsonl. Status, doctor, validate, render, ops,
and journal are read-only and default to local.`;
