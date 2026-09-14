# Kore

Kore is a provider-neutral Kubernetes platform with a Node.js/TypeScript command
line. Desired state lives in `infra/catalog`, environment overlays, Helm charts,
Crossplane APIs, and policy/observability assets. `kore` coordinates Minikube,
Helm, kubectl, OpenTofu, and Kubernetes controllers without taking ownership of
their reconciliation loops.

## Quick start

```sh
mise install
mise exec -- npm --prefix tools/kore install
mise exec -- npm --prefix tools/kore test
mise exec -- npm --prefix tools/kore run test:opa
mise exec -- npm --prefix tools/kore run kore -- doctor --environment local
mise exec -- npm --prefix tools/kore run kore -- validate --environment local
mise exec -- npm --prefix tools/kore run kore -- cluster up --environment local
mise exec -- npm --prefix tools/kore run kore -- tunnel start --environment local
mise exec -- npm --prefix tools/kore run kore -- platform bootstrap --environment local
mise exec -- npm --prefix tools/kore run kore -- trust install --environment local
mise exec -- npm --prefix tools/kore run kore -- platform up --environment local
mise exec -- npm --prefix tools/kore run kore -- app up reference --environment local
```

`platform up` installs only platform releases; applications are always a separate
operation. Run `platform bootstrap` before `trust install`: bootstrap installs
cert-manager and the other controllers required for the local issuer, while
`trust install` establishes host trust and waits for the issuer to become ready.
For Minikube, `platform up` starts the managed tunnel automatically before
configuring the local Gateway. It can also be managed explicitly with
`kore tunnel start|status|stop`; platform stop and destroy clean it up.
Status, validate, and render are read-only. Mutations require an explicit
environment and use the configured kube context, never the current kubectl
context. Destruction requires `--yes`; retained claims additionally require
`--purge-data`.

### Minikube tunnel

The local Gateway uses a LoadBalancer address. Kore manages the required
detached `minikube tunnel` process for the explicit `kore-local` profile:

```sh
# Start or reuse the tunnel
mise exec -- npm --prefix tools/kore run kore -- tunnel start --environment local

# Inspect the managed tunnel PID and state
mise exec -- npm --prefix tools/kore run kore -- tunnel status --environment local --json

# Stop the tunnel and remove its state
mise exec -- npm --prefix tools/kore run kore -- tunnel stop --environment local
```

`platform up` starts the tunnel automatically before configuring the local
Gateway. `platform stop` and `platform destroy` stop it automatically. A stale
tunnel PID is discarded and replaced on the next `tunnel start`. Tunnel state is
stored under `.kore/state` and should not be committed.

For the local profile, the focused cluster lifecycle commands are:

```sh
mise exec -- npm --prefix tools/kore run kore -- cluster status --environment local
mise exec -- npm --prefix tools/kore run kore -- cluster stop --environment local
mise exec -- npm --prefix tools/kore run kore -- cluster destroy --environment local --yes --purge-data
```

`cluster destroy` is destructive. Omit `--purge-data` to preserve retained data;
the command will refuse to destroy a profile while retained data exists.
If a live integration or platform attempt fails, destroy the explicit local
profile before retrying from a clean cluster:

```sh
mise exec -- npm --prefix tools/kore run kore -- cluster destroy --environment local --yes --purge-data
```

`kore validate --environment <name>` also checks that every application has
separate resources and workload charts with no provider-specific references.

The catalog and environment files intentionally use JSON-compatible YAML. This
makes schema failures deterministic before any cluster mutation while remaining
valid YAML for Helm/Kubernetes tooling. See `infra/plans/1-initialize.md` and
`infra/plans/2-implementation.md` for the lifecycle and capability contracts.
