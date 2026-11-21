# Kore

Kore is a provider-neutral Kubernetes platform with a Node.js/TypeScript command
line. Desired state lives in `infra/catalog`, environment overlays, Helm charts,
Crossplane APIs, and policy/observability assets. `kore` coordinates k3d,
Helm, kubectl, OpenTofu, and Kubernetes controllers without taking ownership of
their reconciliation loops.

For the plans, decisions, and reference files behind this, start at
[`docs/index.md`](docs/index.md). To run the platform, start with the
[operator guide](docs/guides/operator.md).

## Quick start

```sh
mise install
mise exec -- npm --prefix tools/kore install
mise exec -- npm --prefix tools/kore test
mise exec -- npm --prefix tools/kore run test:opa
mise exec -- npm --prefix tools/kore run kore -- doctor --environment local
mise exec -- npm --prefix tools/kore run kore -- validate --environment local
mise exec -- npm --prefix tools/kore run kore -- local up --environment local
```

`local up` creates or reuses the k3d cluster `kore-local`, reconciles the platform and local
trust, generates/reuses a local API token and syncs local secrets, builds each
locked application, publishes it to the in-cluster registry, signs and verifies
the registry digest, then deploys that exact digest. The token is stored at
`.kore/state/environments/<environment>/reference-api-token` with owner-only permissions and survives
`local down --prune`; it is never committed. Optional SOPS-encrypted local
secret documents can still be placed in `infra/environments/local/secrets/`.

The registry location is one per-environment variable, `registry.address` in
`environment.yaml` (local: `10.96.0.50:5000`, inside `cluster.serviceCidr`;
remote: a hostname such as `registry.example.internal`). Kore derives the
registry Service pin, the image policy glob, and every push, sign, and deploy
reference from it, so changing it there moves everything
([ADR 0031](docs/decisions/0031-registry-address-platform-variable.md)).

The platform's names are one per-environment field too, `platform` in
`environment.yaml`: `domain` (local: `kore.internal`) and `organizationId`
(`platform`). The local domain is `kore.internal` (ADR 0147). `kore.local` was a deprecated
alias, a listener on the local Gateway with no names of its own, and is removed
(ADR 0176). The names under `kore.internal` resolve only
while `platform-dns` is on and the resolver file is installed
(`kore dns install`). `kore` validates both before any cluster command (a lowercase DNS
name of at least two labels, and one lowercase label). `domain` is the field
every copy of the domain derives from: the Gateway hostname, the platform APIs,
Keycloak and Backstage `platformDomain`, the certificate host, the reference
application's route host and the delivery path's `platformDomain`.
`organizationId` builds the platform organization's wildcard
`*.<organizationId>.<domain>`, the registry hostname
`registry.<organizationId>.<domain>` and the host DNS check's
`<organizationId>.<domain>`, and, behind their flags, the shared Gateway's route
domain (`platform-shared-gateway`), the Organization zone default
(`platform-hostname-ownership`) and the database routes (`database-routes`). It
does not yet name the platform `Organization` resource or the golden-path load
test's hostname, which both use the literal `platform`, so changing it moves the
derived hosts and not those two. A values file or chart default that repeated the
domain would be a second owner, so none do; a service host is
`<service>.<organizationId>.<domain>`
([ADR 0042](docs/decisions/0042-organization-domains-by-delegation.md)). A
check renders the platform Gateway and the routes attached to it and fails when
a route host has no listener hostname that serves it.

An overlay may also carry a `features:` map of flag name to boolean, off unless
set `true`. `kore` validates it with the rest of the overlay before any
mutation and passes each flag to local charts as `features.<name>`, so charts
and the CLI read one switch
([ADR 0077](docs/decisions/0077-live-proof-gates-activation-not-merge.md)).
The `ingress-agentgateway` flag, on in `local` and off in every other overlay, selects the platform Gateway's
GatewayClass: `kore` derives `gateway.className` (`istio` off, `agentgateway`
on) when rendering `kore-platform-config`.
The `gateway-class-change-release` flag, on in `local` and off in every other overlay, lets that reconcile
delete and recreate the platform Gateway when its class changes, with a brief
ingress outage; with it off the step does nothing.
The `gateway-rollback-order` flag, on in `local` and off in every other overlay, moves the refusal of a
gated-off release that is still installed to after the components are reconciled,
so a rollback can re-render `kore-platform-config` first; with it off the refusal
stays up front.
The `agentgateway-mesh-enrollment` flag, on in `local` and off in every other overlay, applies only with
the agentgateway class: it labels the `kore-gateway` data-plane pod
`istio.io/dataplane-mode: ambient` and adds a `PeerAuthentication` that is
permissive on the gateway's listener port only; with it off, or under the Istio
class, the render is unchanged.
The `registry-tag-pruning` flag, off in every overlay, lets `kore local up`
delete per-run image tags older than seven days from the local registry and
collect garbage; it turns on registry delete support in the `oci-registry` chart
([ADR 0094](docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md)).

A Helm or local-chart catalog component may set `featureFlag: <name>` to be
gated by one of these flags; validation rejects it on a manifest component. Validation fails, naming the component, when the environment does not
declare the flag in `features:` (set it `false` to keep the component off), or
when an enabled component depends on a gated-off one. A gated-off component is
validated, pinned and rendered like any other, but `kore local up` and
`kore platform up` install nothing for it, and `kore platform status` reports it
as `gated-off` without failing. If a flag is turned off after the component
was installed, status reports it `degraded` with the fix in its detail, and
`up` fails fast until the release is removed or the flag is turned back on.

Kore records per-machine image digests under ignored `.kore/` state and keeps its
local-only signing key as the `kore-system/kore-local-signing-key` Secret, never
on disk; the key is destroyed with the cluster and regenerated by the next
`local up`, which also publishes its public half alone as the
`cosign-system/kore-local-signing-pub` Secret for Policy Controller. A `.kore/keys/local` directory from earlier versions is unused and
can be deleted. It does not edit the shared release image lock. Local signatures have no Rekor entry and are not release
signatures. For a state-preserving teardown, run `mise exec -- npm --prefix tools/kore run kore -- local down
--environment local`; this stops the cluster without uninstalling
releases or deleting data. Add `--prune` to explicitly destroy the cluster; it
refuses while retained data exists. Add `--purge-data` as well to purge that
retained data. `platform up` remains available when you want only platform
reconciliation. The local Gateway needs no tunnel: the k3d load balancer
maps host port 443 to it, bound to the loopback address `127.0.0.1` only, so
nothing on the network reaches it ([ADR 0131](docs/decisions/0131-k3d-publishes-host-ports-on-the-loopback-address.md)).
Status, validate, and render are read-only. Mutations require an explicit
environment and use the configured kube context, never the current kubectl
context. Direct destruction requires `--yes`; retained claims additionally
require `--purge-data`. `local down --prune` destroys without purging; `local down --prune --purge-data` opts into both.

`kore app up` deploys only an image that release automation signed (`--image-lock <release images.lock.json>`);
a source build runs through `kore local up` ([ADR 0063](docs/decisions/0063-lifecycle-resume-and-release-only-app-up.md)).

`kore app up <name> --environment <name>` is refused, before anything is verified
or applied, until the application admission gate is open for the repository's
platform generation ([ADR 0054](docs/decisions/0054-application-admission-gate-closed-at-foundation.md)).
`kore platform up` closes the gate first and opens it only after every component is
ready in that run, and the running platform images pass the image inventory
([ADR 0056](docs/decisions/0056-platform-image-inventory.md): `audit` locally, `enforce`
in managed environments); `platform status` reports both. The refusal names the gate's state and
the remedy. The readiness manifest `infra/catalog/readiness.yaml` lists every
prerequisite the gate waits for, and each open or close records evidence in the
ConfigMap `kore-system/kore-platform-readiness`
([ADR 0067](docs/decisions/0067-platform-readiness-manifest-and-evidence.md)).
`kore platform gate-check --environment <name>` re-evaluates the manifest and closes
the gate, never opens it, when a prerequisite is unhealthy; running workloads are untouched.

`platform status` also lists cluster CRDs that no catalog component owns, or more than one,
as degraded; this is an audit and never fails `platform up`
([ADR 0057](docs/decisions/0057-runtime-crd-ownership.md)). CRDs in a group the
environment declares in `providerOwnedCRDGroups` (k3s's own on k3d) count as
provider-owned ([ADR 0088](docs/decisions/0088-provider-owned-crd-groups.md)).

`kore app down <name> --environment <name>` uninstalls only the workload release
(rerunning it is safe) and keeps the application's resources release and data.
It lists the retained claims and volumes that remain; a failed lookup is a
warning on stderr, not a failure. With `--json` it always prints
`{ "name": "...", "retained": [...] }` (plus `warnings` when a lookup failed),
with an empty list when nothing is retained.

### Local Gateway

The local Gateway answers on `https://kore.internal/` (or your route path)
from this machine only: the host port binds `127.0.0.1`, and a cluster created
before that binding is refused until it is recreated (ADR 0131).
While `platform-dns` is off, `kore.internal` resolves through the hosts entry you
already have; kore writes none.
The k3d load balancer maps host port `443` to the Gateway Service's node port
(30443), so no tunnel process is needed ([ADR 0085](docs/decisions/0085-k3d-gateway-answers-through-a-node-port.md)).
`platform up` waits for the Gateway Service to publish the configured node
port before it reports the Gateway ready.

With the `platform-dns` flag on, the local overlay also publishes the Gateway
on `127.0.0.1:443`, the port names resolve to, and the platform DNS on
`127.0.0.1:1053`, over both TCP and UDP, through the same load balancer
(node port 31053 on the `kore-platform-dns` Service in `kore-dns`). The two
mappings in `k3d.ports` name the flag, so with it off they are not created,
compared for drift or probed. k3d fixes ports when it creates the cluster, so
turning the flag on for a cluster created without them fails the drift check
with the recreate instruction (`kore local down --prune`, then `kore local up`).
The `kore-dns` namespace is exempt from image enrollment so the DNS answers
before anything else
([ADR 0132](docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md)).

For the local profile, the focused cluster lifecycle commands are:

```sh
mise exec -- npm --prefix tools/kore run kore -- cluster status --environment local
mise exec -- npm --prefix tools/kore run kore -- cluster stop --environment local
mise exec -- npm --prefix tools/kore run kore -- cluster destroy --environment local --yes --purge-data
```

`cluster destroy` is destructive. Omit `--purge-data` to preserve retained data;
the command will refuse to destroy a profile while retained data exists.
Retained data is every PersistentVolumeClaim or PostgreSQL instance labeled
`platform.kore.dev/retention=Retain`. The `oci-registry` image store is
rebuildable cache on `kore-standard`, so it never blocks a destroy.

### Leaving Minikube

Earlier versions ran the local environment on Minikube
([ADR 0076](docs/decisions/0076-k3d-replaces-minikube.md)). Kore no longer
supports it, and there is no migration: existing Minikube data is abandoned.
An overlay with `provider: minikube` is rejected at validation. Delete the old
profile once, by hand, when you no longer need it (Kore never does this for
you):

```sh
minikube delete -p kore-local
```

If you want the data first, export it from the Minikube version you ran it on,
then restore it into a fresh k3d profile with `kore data restore`.

### Export and restore retained data

```sh
mise exec -- npm --prefix tools/kore run kore -- data export --environment local
mise exec -- npm --prefix tools/kore run kore -- data restore --environment local --from <artifact>.sql.age --identity <your age key file>
```

`data export` dumps each retained CloudNativePG database with `pg_dump`,
encrypts the stream with `age` to every recipient the `.sops.yaml` rule for the
environment names (a comma-separated list, one public key per machine), and writes only ciphertext plus a manifest (SHA-256 of the
artifact, contents, environment, time) to the gitignored
`.kore/exports/<environment>/`. It fails while the recipient is still
`AGE-RECIPIENT-MUST-BE-CONFIGURED`. `cluster destroy` accepts an unreachable
profile only when such an export still matches its manifest.

`data restore` targets a fresh profile (`kore local up` first). It verifies the
digest, decrypts through `age --identity` (or `SOPS_AGE_KEY_FILE`; Kore never
reads the key), and refuses a database that already holds tables unless
`--overwrite-data --yes` replaces it. See
[ADR 0029](docs/decisions/0029-local-export-and-restore.md).

### Rotating registry credentials

Kore reuses the registry credentials it generated and never rotates them on its
own. After a suspected leak, rotate them explicitly:

```sh
mise exec -- npm --prefix tools/kore run kore -- registry rotate-credentials --environment local --yes
```

The command replaces both passwords and every enrolled namespace's
`kore-registry-read` Secret in an order that keeps admission reading signatures
(the proxy accepts the old and new read identity until the pull Secrets are
replaced), then waits until the proxy refuses the old passwords. It takes a few
minutes, prints no secret, and is safe to rerun after a failure. See
[ADR 0055](docs/decisions/0055-registry-credential-rotation.md).

### Swapping the local signing key

The local profile trusts one cosign key. To replace it:

```sh
mise exec -- npm --prefix tools/kore run kore -- signer swap-key --environment local --yes
```

The command deletes the old key pair, generates a new one, and republishes only
the public key to Policy Controller, so the old key is never trusted beside the
new one. Images signed with the old key are denied until they are signed again
(`kore app up` signs again). Managed environments refuse: they trust release
identities, not a key. Safe to rerun after a failure. The opt-in live proof is
`npm --prefix tools/kore run test:live:signer`.

### Storage classes

The `platform-storage` release defines two StorageClasses. Both allow volume
expansion; neither is a backup.

| Class           | Reclaim  | Use for                                                                                                                                                 |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kore-standard` | `Delete` | Disposable data (telemetry, caches, the registry image store). The volume is deleted with its claim. Claims label `platform.kore.dev/retention=Delete`. |
| `kore-retained` | `Retain` | Data to keep (databases). The volume survives claim deletion. Claims label `platform.kore.dev/retention=Retain`.                                        |

Gatekeeper audits that every claim declares one of those labels and that
`Retain` claims use `kore-retained`.

If a live run or platform attempt fails, destroy the explicit local
profile before retrying from a clean cluster:

```sh
mise exec -- npm --prefix tools/kore run kore -- cluster destroy --environment local --yes --purge-data
```

`kore validate --environment <name>` also checks that every application has
separate resources and workload charts with no provider-specific references.
For an environment that declares a `platformMirror` (`managed-example`), it also
checks that every approved platform image has a rewrite to that signed mirror at
its approved digest. It refuses a Gatekeeper constraint with no
`enforcementAction` (exit 1, before any cluster is touched), naming the file and
the fix: set `enforcementAction` to `deny`, `warn` or `dryrun` explicitly. A
missing action would mean deny with no audit stage, and a promotion record does
not stand in for it.
`kore validate` can also report warnings: findings that do not fail validation.
Human output prints each as a `warning:` line on stderr, and `--json` adds a
`warnings` array (omitted when empty). Warnings never change the exit status.
An environment overlay sets `exemptionCheck` to `audit` or `enforce`
(optional; unset reads as `audit`, as with `imageInventory`,
[ADR 0056](docs/decisions/0056-platform-image-inventory.md)); `local` stays on
`audit`. The field is accepted and validated now; the exemption check that
consumes it is a later ticket under #613.
`kore validate --environment managed-example --platform-image-lock <file>`
additionally checks a release's `platform-images.lock.json` (attached to the
GitHub release as an asset) against the committed overlay and image policy
([ADR 0044](docs/decisions/0044-managed-platform-images-from-the-mirror.md)).

The catalog and environment files intentionally use JSON-compatible YAML. This
makes schema failures deterministic before any cluster mutation while remaining
valid YAML for Helm/Kubernetes tooling. See [`docs/index.md`](docs/index.md) for the plans and decisions behind the
lifecycle and capability contracts.

## Releases

Tags are cut by [release-please](https://github.com/googleapis/release-please)
from Conventional Commits. Each push to `main` updates a release pull request
(version bump in `version.txt`, `CHANGELOG.md`); merging it creates the `vX.Y.Z`
tag and GitHub release. A tag made with the default `GITHUB_TOKEN` starts no
workflow, and signing from `main` would give the identity `...@refs/heads/main`,
so the workflow's `dispatch` job re-runs `release.yaml` at the new tag. Only that
tag run signs. Maintainer setup: allow Actions to create pull requests
(Settings > Actions > General), and add the `github-actions` integration as a
bypass actor in the `v*` tag ruleset so it can create tags. Versions start at
0.1.0 (`feat` bumps the minor while below 1.0).

Running `release.yaml` at a `vX.Y.Z` tag (pushed, or by the dispatch above) runs `.github/workflows/release.yaml`, which builds the
reference image, pushes it to `ghcr.io/corekraft/kore/reference` (the `IMAGE`
variable in the workflow), signs the digest with keyless Cosign, verifies it
against the exact workflow-on-tag identity, and uploads an `images.lock.json`
artifact. To accept a release, copy the digest into `infra/catalog/images.lock.json`
and add the tag's subject
(`https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/vX.Y.Z`)
to the managed environment's `trust.subjects`; patterns are rejected. Protect `v*`
tags with a repository ruleset first: the workflow cannot configure that, and an
unprotected tag push mints a trusted signature. See
[ADR 0028](docs/decisions/0028-image-trust-authority.md).

## Scans

`mise run scan` runs the pinned security and quality scans: TruffleHog (secrets
in history and tracked files), OSV-Scanner (npm lockfiles), Semgrep with the
committed rules in `infra/policies/semgrep`, actionlint and zizmor (workflows),
and hadolint (Dockerfiles). Run one with `mise run scan-secrets`, `scan-vulns`,
`scan-sast`, `scan-workflows`, or `scan-dockerfiles`. CI fails on any finding,
except the audit-mode Semgrep rules in `infra/policies/semgrep/kore-audit.yaml`
(`mise run scan-sast-audit`), which report and never fail.
The scans cover both npm packages, `tools/kore` and `tools/harness`. CI builds
`skills/bin/harness.mjs` (`mise run harness-build`); it is never committed
([ADR 0092](docs/decisions/0092-the-harness-bundle-is-a-build-output-not-a-committed-file.md)).
See [ADR 0030](docs/decisions/0030-security-and-quality-scans.md).

## Commands

Every mutating command appends to an operations journal at
`.kore/state/journal/<environment>.jsonl` (gitignored). The journal records the
command, each external process it ran (redacting secret-looking flag values,
never process input or environment), and the outcome. If the journal cannot be
written at the start, the mutation does not run. Run `kore journal` to see
recent operations and any that were interrupted.

Run `kore --help` for every flag; the usage text in `tools/kore/src/cli/usage.ts`
is the source of truth.

`kore local fetch-lock --output <file> [--commit <sha>]` is read-only: it writes the main chart lock of a commit (default: the checkout's HEAD) from its `charts-main` artifact, which is kept 30 days, to the path you name, so a local proof can pass it to `--platform-chart-lock`. It names the cause and the fix when the artifact has expired or is missing, or when `gh` is not signed in. `--require-fresh-lock` still gates the proof.

| Command         | Does                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kore doctor`   | Checks pinned tools and prerequisites. Read-only.                                                                                                                                                                                                                                                                                                              |
| `kore validate` | Validates catalogs, environments, and release ordering. Read-only.                                                                                                                                                                                                                                                                                             |
| `kore status`   | Reports each Organization and Service claim's readiness, behind the platform-organization-service-apis flag. Read-only.                                                                                                                                                                                                                                        |
| `kore cluster`  | Starts, stops, destroys, or reports the k3d cluster.                                                                                                                                                                                                                                                                                                           |
| `kore platform` | Bootstraps, reconciles, stops, destroys, renders, or reports platform releases.                                                                                                                                                                                                                                                                                |
| `kore app`      | Deploys, removes, or reports one application's resources and workload releases.                                                                                                                                                                                                                                                                                |
| `kore data`     | Exports retained CloudNativePG data as an age-encrypted, digest-manifested artifact, or restores it into a fresh profile.                                                                                                                                                                                                                                      |
| `kore local`    | Brings the whole local environment up or down (`--prune` destroys it; `--prune --purge-data` also purges retained data). `local lock-check --platform-chart-lock <file>` is read-only: it compares the lock with the charts the checkout packages to and exits 1 on drift, and `local up --require-fresh-lock` refuses on the same drift (otherwise it warns). |
| `kore registry` | Rotates the registry's push and read passwords and the enrolled pull Secrets (`rotate-credentials --yes`).                                                                                                                                                                                                                                                     |
| `kore signer`   | Swaps the local cosign signing key and republishes only the public key to Policy Controller (`swap-key --yes`).                                                                                                                                                                                                                                                |
| `kore secrets`  | Syncs local secrets, including the generated API token, into the cluster.                                                                                                                                                                                                                                                                                      |
| `kore trust`    | Installs the local certificate authority before the Gateway is configured.                                                                                                                                                                                                                                                                                     |
| `kore dns`      | Writes or removes the host resolver file for the platform domain, pointing it at the platform DNS on loopback (ADR 0132). Asks before `sudo` unless `--yes`; `kore local up` runs the install itself with `platform-dns` on, on a terminal; `uninstall` removes only a file kore wrote.                                                                        |
| `kore ops`      | Offline checks: dependency inventory and integrity, recovery objectives, upgrade from the previous release, CRD safety. Read-only.                                                                                                                                                                                                                             |
| `kore policy`   | Records audit evidence, promotes one Gatekeeper constraint from dryrun to deny on clean evidence, or rolls it back. Edits the repository only.                                                                                                                                                                                                                 |
| `kore journal`  | Lists recent mutating operations and flags interrupted ones. Read-only.                                                                                                                                                                                                                                                                                        |
