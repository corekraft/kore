---
status: accepted
summary: kore keeps installing the bootstrap, core, and observability phases through Helm, installs the platform organization's Argo CD in core, and hands every configuration-phase release except the image policy to that Argo CD as Helm charts from the platform OCI registry, with its health gating application admission.
date: 2026-11-09
last-verified: 2026-11-09
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
