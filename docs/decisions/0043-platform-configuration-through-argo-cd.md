---
status: accepted
summary: kore keeps installing the bootstrap, core, and observability phases through Helm, installs the platform organization's Argo CD in core, and hands every configuration-phase release except the image policy to that Argo CD as Helm charts from the platform OCI registry, with its health gating application admission.
date: 2026-11-09
last-verified: 2026-11-14
---

# ADR 0043: Deliver platform configuration through the platform Argo CD

Source: [`docs/vision.md` § The Portal: Backstage and Argo CD Out of the Box](../vision.md#the-portal-backstage-and-argo-cd-out-of-the-box)

Refines: [ADR 0002](0002-tool-responsibility-boundaries.md),
[ADR 0011](0011-catalog-owned-releases-and-versions.md),
[ADR 0016](0016-release-readiness-checks-drive-wait-and-status.md), and
[ADR 0027](0027-bootstrap-installs-controllers-and-image-trust-only.md).

## Context

Each tenant's Argo CD owns its tenant workloads
([ADR 0041](0041-backstage-and-argo-cd-per-tenant.md)). Platform components are
installed by `kore` through Helm in phases, and changes apply only when someone
runs `kore platform up`, so drift persists until the next run. Moving everything
to Argo CD would rebuild the fail-closed bootstrap, seed images, and trust
closure as sync waves, and would need Argo CD trusted before image trust
exists. The configuration phase (ADR 0027) changes most often and depends only
on controllers that earlier phases install.

## Decision

- **`kore` keeps the early phases.** Bootstrap, core, and observability
  releases stay owned by `kore` through Helm, with their readiness checks and
  ordering unchanged.
- **The platform Argo CD is a core release.** `kore` installs the platform
  organization's Argo CD in the core phase. It is cluster-scoped, in its own
  AppProject, and only the platform operators' Keycloak group may change it.
- **Argo CD owns the configuration phase.** Every configuration-phase release
  moves to Argo CD: today `opa-authorizer`, `kore-postgresql-api`,
  `kore-policy-templates`, `kore-policy-constraints`, `kore-local-tls`, and
  `kore-platform-config`. New platform APIs and the per-tenant compositions
  join this phase.
- **Except the image policy.** `kore-image-policy` stays with `kore`, so the
  tool that deploys cannot change which signatures are trusted
  ([ADR 0028](0028-image-trust-authority.md)).
- **One owner, declared in the catalog.** Each catalog release names its owner,
  `kore` or `argocd`. For an `argocd` release, `kore` creates the Argo CD
  Application from the catalog's chart, version, and values, and never runs
  Helm on it.
- **Argo CD health gates admission.** `kore platform up` waits for each
  `argocd` Application to be synced and healthy, then runs the catalog's
  readiness checks, before the application admission gate opens
  ([ADR 0004](0004-fail-closed-application-admission-gate.md)).
  `kore platform status` reports Application sync and health.
- **Configuration stays Helm charts, served over OCI.** `kore` packages each
  configuration release's chart and pushes it to the platform registry as an
  OCI Helm chart, and the Application renders it with Helm from there. A local
  change needs no git push.
- **Published charts are immutable.** `kore` gives each content change a new
  chart version, never republishes a version, and records and signs the
  chart's digest, so Argo CD deploys only what was built from the repository.

## Consequences

- Drift in configuration-phase resources is corrected continuously; drift in
  earlier phases still waits for the next `kore platform up`.
- The platform Argo CD holds cluster-wide rights, so its access is limited to
  operators and its own changes go through `kore`.
- Existing clusters must hand their configuration-phase Helm releases to
  Argo CD without deleting resources; the handover is implemented, tested, and
  proven by a live run before merge.
- The Argo CD repository credentials for the platform registry follow the
  registry's authentication
  ([ADR 0034](0034-registry-authentication-and-authorization.md)).
- Whether the pinned Argo CD can pin a Helm OCI chart by digest, rather than
  by version, is checked before implementation.
- The bootstrap spec's phase-boundary test gains a check that no `argocd`
  release is installed by Helm.

## Amendment: the handover from Helm to Argo CD

Context: Plan 15 Step 5, behind `platform-argocd-delivery` (off everywhere). The six configuration releases must pass from Helm to Argo CD on a fresh and on an existing profile without deleting a resource.

Decision:

- **One release, `kore-config-delivery`, owned by `kore`.** A catalog release of the chart `infra/charts/platform-config-delivery`, in the `argocd` namespace, gated by the flag and ordered after `argocd`. It renders one `AppProject`, `platform-configuration`, and one `Application` per handed-over release. Its values are the `entries` of `platform-charts.lock.json` and each release's namespace read from the catalog, so the lock owns the digests and the catalog owns the namespaces. The chart refuses a missing entry, a missing namespace, a digest that is not `sha256:` and an entry for `kore-image-policy`.
- **Each Application pins its chart by digest.** `repoURL` is the lock's chart path in the platform registry without a scheme, `chart` the release name, and `targetRevision` the lock's digest, never the version or a tag.
- **The Application adopts, it does not recreate.** `helm.releaseName` is the release's own name and the destination namespace is the release's own, so a rendered resource name equals the one Helm created. Sync uses server-side apply, and `CreateNamespace`, `Replace` and `Force` are off.
- **The handover deletes nothing.** `prune: false`, so a resource the new chart no longer renders stays until a later, separate step turns pruning on; no `resources-finalizer`, so deleting an Application leaves its resources; `PruneLast`. Helm's release secret (`sh.helm.release.v1.*`) stays as an inert record: `kore` never runs `helm uninstall` on a handed-over release.
- **The safe order, and its window.** (1) The flag turns on and `kore` installs `argocd` in core. (2) `kore` installs `kore-config-delivery`, creating the AppProject and the Applications. (3) Argo CD syncs each Application over the resources Helm made; on a fresh profile nothing exists and it creates them. (4) Only a synced and healthy Application lets the catalog's readiness checks run and the admission gate open. `releaseOwner` turns `argocd` for the six releases on the flag alone, but `helmInstalledComponents` skips one only once `kore-config-delivery` is deployed, which `platformUp` reads from the cluster with `helm status`. Until then Helm keeps managing the six, so there is never a window with no owner, and the owner changes only after the Applications exist. A failed `kore-config-delivery` leaves Helm managing the six; a rerun retries it and every step is idempotent. With the flag off nothing is argocd-owned and nothing changes. Nothing is deleted at the handover (Helm release secrets stay, nothing prunes, no Application finalizer).
- **Access.** The AppProject admits only the platform registry's chart repositories, the six release namespaces on the in-cluster server and the exact cluster-scoped kinds those charts render (no wildcard), and its `operators` role (every action on its Applications) is bound to the group `platform-operators`. Argo CD's own RBAC mapping of that group to the Keycloak realm arrives with plan 15 Step 6.

Not decided, needs a live run: that the pinned Argo CD accepts a digest as an OCI `targetRevision` (checked first on the live run; if it does not, the fallback is the lock's version, which is content-addressed and so equally immutable, with the digest verified by `kore` before the Application is created), that server-side apply adopts Helm's client-side-applied fields without a conflict, and the read credential for the registry.

Amendment (values and credential): `kore platform up --platform-chart-lock <platform-charts.lock.json>` composes the chart's values and is required while the flag is on. Before it touches the cluster, `kore` checks the lock against the catalog: a version 1 lock, an entry with a `sha256:` digest and an OCI path for every catalog release with `owner: argocd`, and none for `kore-image-policy`; each error names the release and the fix. The values are `charts` (the lock's `chart` and `digest`), `namespaces` (the catalog's), and `gatewayClassName` (derived from the ingress flag, passed to `kore-platform-config` as `gateway.className`). They reach Helm as `--set-json`, so no file is written. Right after `argocd` is installed in bootstrap, so before `kore-config-delivery` creates the Applications, `kore` applies an Argo CD repository Secret (`kore-platform-charts-<n>`, `argocd` namespace) holding the registry's read identity ([ADR 0034](0034-registry-authentication-and-authorization.md)) through `kubectl apply --filename=-`, never to disk, an argument or git. It does so only for a chart repository on the platform registry's own address; a chart on another host (a public or provider-owned registry) gets no credential, so the read identity never leaves its registry.

Remaining: `kore local up` passing the lock to `platform up`, waiting for each Application to be synced and healthy before the gate and reporting it in `kore platform status` (plan 15 Step 5, second item), and a live run.
