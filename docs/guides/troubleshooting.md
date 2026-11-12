# Troubleshooting

Start with `kore platform status --environment local`: each row says `ready`,
`degraded`, or `missing` and names the cause. `kore journal --environment local`
shows the last mutations and any that were interrupted. Commands are written as
`kore ...` (see the [operator guide](operator.md)).

| Symptom                                                        | Cause and fix                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kore doctor` fails                                            | A pinned tool is missing or the wrong version. Run `mise install`.                                                                                                                                                                                      |
| `kore validate` fails                                          | The message names the file and field. Config files are JSON-compatible YAML; fix the named catalog, overlay, or `trust` entry.                                                                                                                          |
| A mutation says the environment is locked                      | Another run holds the lock. A lock whose process is gone is recovered by the next run; a live one is never broken. Read `kore journal`.                                                                                                                 |
| `kore app up` is refused, naming the admission gate            | The gate is closed until every component is ready in one `kore platform up`. Run `kore platform up --environment local`, then read `kore platform status`.                                                                                              |
| `registry-trust` degraded                                      | The registry CA is missing. Run `kore platform up --environment local` ([ADR 0058](../decisions/0058-registry-transport-tls.md)).                                                                                                                       |
| `image-inventory` lists images                                 | Classification is `seed`, `tag-only`, or `unknown`. In `audit` it only reports; in `enforce` it fails bootstrap. Roll the workload to its signed digest ([ADR 0056](../decisions/0056-platform-image-inventory.md)).                                    |
| `crd-ownership` degraded                                       | A CRD has no catalog owner or several. Declare it in exactly one component's `ownsCRDs` or `ownsCRDGroups`.                                                                                                                                             |
| `capacity` degraded                                            | Requests are at or above 80% of allocatable. Raise `cluster.cpus` or `cluster.memoryMB` and recreate the profile ([budgets](../operations/resource-budgets.md)).                                                                                        |
| `backups` degraded                                             | Retained data exists and the newest export is older than the RPO, or missing. Run `kore data export --environment <env>` ([backups](../operations/backups.md)).                                                                                         |
| Pod `ErrImageNeverPull`                                        | Local images are pulled `Never`; the image is missing from the node. Rerun `kore local up --environment local`. Do not delete node images by hand.                                                                                                      |
| A pod is rejected by admission                                 | The image is unsigned, tag-only, or signed by another key. Read the webhook message; republish through `kore app up`. If the registry or verifier is down, `kore app status <name>` reports it degraded.                                                |
| A release is stuck `uninstalling` or `pending-install`         | Rerun `kore platform up --environment local`; reconcile removes a never-deployed release and retries once.                                                                                                                                              |
| `https://kore.local:8443/` does not answer                     | The k3d load balancer publishes the port with no host process; check `kore platform status --environment local` for the gateway, and rerun `kore local up --environment local`. The host CA must be trusted (`kore trust install --environment local`). |
| `cluster destroy` / `local down --prune` refuses               | Retained data exists. Run `kore data export --environment local`, then add `--purge-data` once it is safe.                                                                                                                                              |
| `kore data export` refuses                                     | The age recipient in `.sops.yaml` is still the placeholder, or retained volumes exist that the dump does not cover.                                                                                                                                     |
| Secrets fail to sync                                           | The age identity is not found. Export `SOPS_AGE_KEY_FILE`; see [`infra/environments/local/secrets/README.md`](../../infra/environments/local/secrets/README.md).                                                                                        |
| Registry authentication fails after a rotation was interrupted | Rerun `kore registry rotate-credentials --environment local --yes`; it resumes.                                                                                                                                                                         |

## Minikube overlays lose host Gateway access

No overlay in the repository uses Minikube since #146, and `kore tunnel` is gone. A Minikube overlay has no host access to the Gateway until plan 9 Step 6 (#157) retires Minikube. A `minikube tunnel` (or its `ssh -L` forward) left over from an earlier version must be stopped by hand, for example `pkill -f "minikube tunnel"`.

## When nothing else works

Destroy the explicit local profile and start clean:

```sh
kore local down --environment local --prune --purge-data
kore local up --environment local
```

This deletes retained data; export first (`kore data export --environment local`).

**Gap:** there is no `kore` command that collects logs or a support bundle.
Use `kubectl --context kore-local` against the namespace named in the failing row.
