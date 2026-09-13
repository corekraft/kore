# Kore

Kore is a provider-neutral Kubernetes platform with a Node.js/TypeScript command
line. Desired state lives in `infra/catalog`, environment overlays, Helm charts,
Crossplane APIs, and policy/observability assets. `kore` coordinates Minikube,
Helm, kubectl, OpenTofu, and Kubernetes controllers without taking ownership of
their reconciliation loops.

## Quick start

```sh
mise install
npm --prefix tools/kore install
npm --prefix tools/kore test
npm --prefix tools/kore run test:opa
npm --prefix tools/kore run build
node tools/kore/dist/cli.js doctor --environment local
node tools/kore/dist/cli.js validate --environment local
node tools/kore/dist/cli.js cluster up --environment local
node tools/kore/dist/cli.js trust install --environment local
node tools/kore/dist/cli.js platform up --environment local
node tools/kore/dist/cli.js app up reference --environment local
```

`platform up` installs only platform releases; applications are always a separate
operation. Status, validate, and render are read-only. Mutations require an
explicit environment and use the configured kube context, never the current
kubectl context. Destruction requires `--yes`; retained claims additionally
require `--purge-data`.

The catalog and environment files intentionally use JSON-compatible YAML. This
makes schema failures deterministic before any cluster mutation while remaining
valid YAML for Helm/Kubernetes tooling. See `infra/plans/1-initialize.md` and
`infra/plans/2-implementation.md` for the lifecycle and capability contracts.
