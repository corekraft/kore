# Support Windows and Upgrade Order

What Kore supports, in which order to upgrade it, and how each step is checked.
Versions live only in [`infra/catalog/versions.yaml`](../../infra/catalog/versions.yaml);
this page never copies them. Evidence per pin is in
[`infra/catalog/compatibility.md`](../../infra/catalog/compatibility.md).

Commands below are written as `kore ...`; run them as
`mise exec -- npm --prefix tools/kore run kore -- ...` (see the
[operator guide](../guides/operator.md)).

## Support window

Kore is pre-1.0 and ships a local platform only. The window is deliberately
narrow:

- **One supported generation: the one in the repository at the tag you run.**
  Kubernetes, controllers, charts, images, and policy bundles are pinned
  together, and `compatibility.md` records the combination that was validated.
  A mix of pins from two tags is unsupported.
- **Upgrade from the previous tag only.** An upgrade from older than the
  previous release tag is unsupported; recreate the profile instead (export
  data first, see [registry and data recovery](registry.md#data-export-and-restore)).
- **Kubernetes** follows the newest minor Minikube supports
  (`cluster.kubernetesVersion` in the environment overlay). No older minor is
  supported.
- **Tag cadence.** Tags come from release-please
  ([README](../../README.md#releases)); each tag's `CHANGELOG.md` entry is the
  release note.

**Upgrade test.** `kore ops upgrade-check` compares the previous release's
catalog with the working tree offline. The opt-in live spec
(`npm --prefix tools/kore run test:integration:upgrade`) creates a throwaway `kore-upgrade-test` profile (environment `upgrade-test`, Gateway port
18443; `kore-local` is never touched), installs the previous tag with that tag's own built CLI from a
detached git worktree, writes a marker into the retained reference database,
then runs this tree's `kore local up` and checks that every component is ready,
the reference app serves, the marker survived, and the PostgreSQLInstance schema
did not change. It needs `SOPS_AGE_KEY_FILE` set (the key file is passed by path, never
copied), and it deletes only the throwaway profile when it finishes. **Gap:** the live spec has not
yet passed, and no release has been tagged after a fresh-install and upgrade
pass.

## Upgrade order

Upgrade one layer at a time and stop at the first failure. Every mutation names
its environment and the configured kube context.

1. **Read the change.** `CHANGELOG.md`, `infra/catalog/compatibility.md`, and
   the diff of `infra/catalog/versions.yaml` and `components.yaml`.
2. **Validate offline.** `kore validate --environment local` checks catalogs,
   release ordering, seeds, and image pins; `kore doctor --environment local`
   checks the pinned host tools. Both are read-only.
3. **Export retained data.** `kore data export --environment local` (needs a
   real age recipient in `.sops.yaml`). Skip only when nothing is retained.
4. **Tooling.** Update the host tools with `mise install`; the `kore` command
   itself is the checked-out `tools/kore`, rebuilt by each `npm run kore`.
5. **Kubernetes.** A new `cluster.kubernetesVersion` does not change a running
   profile. **Gap:** no test proves that `kore cluster up` upgrades an existing
   Minikube profile's Kubernetes version; the supported path is `kore local down
--prune` (with `--purge-data` only after a verified export) and a fresh
   `kore local up`.
6. **CRDs and controllers, then charts.** `kore platform up --environment
local` reconciles in catalog order: CRD-owning controllers first
   (Gateway API, cert-manager, Gatekeeper, Policy Controller, Istio,
   Crossplane, External Secrets, CloudNativePG, OpenTelemetry), then the
   configuration phase. A release whose chart or values hash is unchanged is
   skipped; a changed one is upgraded with `helm upgrade --install`. Helm does
   not upgrade CRDs shipped in a chart's `crds/` directory; the catalog's
   `ownsCRDs` and `ownsCRDGroups` name who owns each, and `kore platform
status` reports CRDs with no owner or several (ADR 0057).
   **Gap:** CRD conversion and rollback before a controller upgrade is not
   validated (plan Step 15); read the controller's own upgrade notes first.
7. **Policy bundles.** Gatekeeper templates and constraints and the OPA bundle
   are catalog components, so step 6 applies them. See
   [policy changes](policy-changes.md).
8. **Applications.** `kore app up <name> --environment local` again; the
   application contract (resources and workload charts, signed digest) does
   not change across a supported upgrade.
9. **Verify.** `kore platform status --environment local` must show every row
   ready, including `registry-trust`, `image-inventory`, `crd-ownership`,
   `capacity`, and the admission gate.

`kore local up` runs steps 6 and 8 together and is idempotent; a second run
upgrades nothing.

## Rollback

- **A failed release:** rerun `kore platform up`. Reconcile uninstalls a release
  that never reached `deployed` and retries once. A kill during a mutation
  leaves a lock that the next run recovers when its owner is gone; read
  `kore journal --environment local` for what was interrupted.
- **A bad version bump:** revert the commit that changed the pin and rerun
  `kore platform up`. **Gap:** there is no `kore` command that rolls a single
  release back; Helm's own `helm rollback` is outside Kore's tested paths, and a
  CRD-bearing controller may not be rolled back safely.
- **Data:** restore the export with `kore data restore` into a fresh profile.
