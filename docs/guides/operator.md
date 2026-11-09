# Operator Guide

Day-to-day running of the local platform. Every command here exists in
`kore --help` (the text in `tools/kore/src/cli/usage.ts`); a test
(`operations-docs.spec.ts`) fails when a page names one that does not.

## Running `kore`

Throughout the docs `kore ...` stands for:

```sh
mise exec -- npm --prefix tools/kore run kore -- ...
```

Install tools and dependencies once:

```sh
mise install
mise exec -- npm --prefix tools/kore install
```

## Rules the commands follow

- Status, doctor, validate, render, and journal are **read-only** and default to
  `local`.
- Every mutation needs `--environment`, uses that environment's configured kube
  context (never the current one), takes an environment lock, and is recorded in
  the ignored `.kore/state/journal/<environment>.jsonl`.
- Destroying needs consent (`--yes`, or `--prune`); purging retained data needs
  `--purge-data` as well.

## Start, stop, and remove

| Goal                                  | Command                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| Check host tools                      | `kore doctor --environment local`                                              |
| Check repository configuration        | `kore validate --environment local`                                            |
| Bring everything up (idempotent)      | `kore local up --environment local`                                            |
| Stop, keeping the cluster and data    | `kore local down --environment local`                                          |
| Destroy the cluster, keep data        | `kore local down --environment local --prune` (refuses while data is retained) |
| Destroy and purge retained data       | `kore local down --environment local --prune --purge-data`                     |
| Reconcile the platform only           | `kore platform up --environment local`                                         |
| Cluster lifecycle only                | `kore cluster status\|stop\|destroy --environment local`                       |
| Tunnel for `https://kore.local:8443/` | `kore tunnel start\|status\|stop --environment local`                          |

`local up` is the supported path. It converges from a fresh or an existing
profile and a rerun upgrades nothing.

## Know the state

```sh
kore platform status --environment local        # every component and platform-wide row
kore platform status --environment local --json
kore app status reference --environment local
kore cluster status --environment local
kore journal --environment local --limit 20     # recent mutations; flags interrupted ones
```

Platform-wide rows, besides one per component: `registry-trust`,
`image-inventory`, `crd-ownership`, `capacity` ([budgets](../operations/resource-budgets.md)), `backups` ([backups](../operations/backups.md)),
and the admission gate. `status` is `ready`, `degraded`, or `missing`, and the
detail names the cause. Application admission stays closed until every row that
gates it is ready.

## Recurring operations

| Task                        | Page                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| Upgrade the platform        | [support and upgrades](../operations/support-and-upgrades.md)                              |
| Back up and restore data    | [registry and data recovery](../operations/registry.md#data-export-and-restore)            |
| Rotate keys and credentials | [signing](../operations/signing-and-keys.md), [trust](../operations/trust-and-rotation.md) |
| Change or promote a policy  | [policy changes](../operations/policy-changes.md)                                          |
| Size the profile            | [resource budgets](../operations/resource-budgets.md)                                      |
| Something is wrong          | [troubleshooting](troubleshooting.md)                                                      |

## Secrets and local trust

`kore secrets sync --environment local` applies the encrypted local secrets and
the generated API token (created once; a second checkout never overwrites it,
and `--rotate --yes` replaces it). `kore trust install --environment local` trusts the
local certificate authority on the host (it may prompt for your password). Never
put plaintext secrets in files or Helm values.

Grafana's admin login is the `grafana-admin` Secret in the `observability`
namespace (keys `admin-user`, `admin-password`). External Secrets generates the
password once in the cluster; nothing is stored in git or values. Read it when
you need it: `kubectl --context kore-local -n observability get secret
grafana-admin -o jsonpath='{.data.admin-password}' | base64 -d`. Grafana only
reads the environment password when it first creates its database, so every
`kore local up` also sets the admin password from that Secret inside the pod
(ADR 0080); an existing profile needs no manual step.

## What is not automated

**Gap:** there is no scheduled backup, no in-place Kubernetes upgrade, no
per-release rollback command, no registry garbage collection, and no
time-bounded break-glass; each is named where it applies in the operations
pages. Production availability and cloud-specific controls are separate
initiatives from this local platform.
