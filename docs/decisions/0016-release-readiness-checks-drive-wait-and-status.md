---
status: accepted
summary: Catalog readiness entries are mandatory, and the same read-only checks drive both bootstrap waits and platform status, with failures naming the component, resource, condition, and reason.
date: 2026-11-08
last-verified: 2026-11-09
---

# ADR 0016: One set of readiness checks for waits and status

Source: [`infra/plans/2-implementation.md` § Progress Record](../../infra/plans/2-implementation.md#progress-record)
(Steps 7, 8 and 11)

## Context

Readiness lists could be empty, so some releases were "ready" once Helm said
deployed. Status never evaluated readiness at all, so a crash-looping Collector
showed ready. Gateway waits covered only `Programmed`, and a missing local
trust anchor surfaced only as a ClusterIssuer timeout.

## Decision

- Every catalog component declares at least one readiness check; both the
  schema (`minItems: 1`) and validation reject an empty list. Releases that
  only create cluster resources use existence checks (`storageclass/`,
  `clusterrole/`, `clusterrolebinding/`) or owned-CRD `crd/` checks.
- `kore status` evaluates each installed release's readiness checks read-only
  (get, wait, rollout status; never apply) with a 3s bound per polled check
  (15s for `kubectl wait` and `rollout status`, whose bound spans kubectl's
  startup; [ADR 0081](0081-declarative-probe-patches-through-a-helm-post-renderer.md))
  and reports `degraded` with the first failing check. Status writes no
  journal entry.
- Gateways are ready only when Accepted, the Gateway Service has a
  LoadBalancer address, Programmed, and every listener has ResolvedRefs. Each
  step is bounded and its failure includes the condition reason
  (`AddressNotAssigned`, `InvalidCertificateRef`).
- Before waiting on a Certificate, `kore` checks its ClusterIssuer and the
  issuer's CA Secret. If either is missing it fails immediately with
  `kore trust install --environment <name>` (or a managed-environment
  instruction), instead of timing out.
- Every readiness failure reads `<resource> not ready (<condition>) within
<timeout>: <reason>`, wrapped with the component name.

## Consequences

- `kore status` and `app up` now probe the cluster per component, so they are
  slower than a Helm-status-only check and need the same fakes in tests.
- Status uses fixed bounds; making them configurable is deferred.

## Refinement: resume applies drifted desired state

A deployed release was previously only awaited on resume, so a changed values
file, chart version, or local chart template never reached an existing profile.
Resume (`reconcileIfNeeded`) now compares a desired-state fingerprint and
upgrades a deployed Helm release when it differs, and still only awaits it when
it matches.

- The fingerprint is a sha256 of the chart, version, `--set`/`--set-string`
  arguments, the content of each values file, and (local charts) the content of
  every file in the chart directory. Paths are relative, so another checkout of
  the same content matches.
- Kore stores it as the Helm revision description (`helm upgrade
--description`) and reads it back from `helm history`. The release is the
  single owner; there is no extra state file, label, or annotation. Merging
  `--values` files and diffing against `helm get values` was rejected: it
  would reimplement Helm's merge semantics and could not see chart template
  changes.
- A release deployed before this change has no fingerprint and is upgraded
  once. A failure reading the history is reported with the release name and
  context rather than treated as current or as drift.
- Manifest components keep their behaviour (server-side apply is idempotent).
  The registry Service rewire remains: Helm cannot change an immutable
  `clusterIP`, so the generic path does not cover it.

## Refinement: opt-in forced conflicts for self-managing controllers

Drift upgrades exposed a case a first install never hits. Helm 4 applies
server-side, and a controller that keeps writing fields of its own release's
objects (the first live case: `policy-controller`'s `webhook` reconciler owning
`namespaceSelector` and `caBundle` of its webhook configurations) makes the
upgrade fail with a field-manager conflict, after which the rollback fails too.

- A catalog component may set `helm: {forceConflicts: true, reason}`. Only
  then does `helmUpgradeArgs` add `--force-conflicts`, so Helm takes the fields
  back and the controller re-reconciles them. It is never on by default, the
  schema and validation require a reason, and the flag is in the args, so it
  already changes the desired-state fingerprint.
- It is set only where the chart renders a field the controller later owns
  and no chart value omits it: `policy-controller` only. cert-manager,
  Gatekeeper, External Secrets, CloudNativePG and the OpenTelemetry operator
  have controllers or cainjector that write only `caBundle`, which their
  charts do not render, so there is no overlap. Istiod's chart omits
  `failurePolicy` on upgrade (`.Release.IsUpgrade`) for the same reason.
- Recovery needs no new path: a release left `failed` after a deployed
  revision is upgraded by the next reconcile and never uninstalled.

## Refinement: webhook readiness is proven, not inferred from the Deployment

A webhook Deployment that rolled out does not mean admission works: the
configuration can still lack a `caBundle`, or its Service can have no ready
endpoint. Step 7's exit criterion is that webhooks report ready, so they are
readiness resources of their own.

- `validatingwebhookconfiguration/<name>` and
  `mutatingwebhookconfiguration/<name>` are readiness kinds. A configuration is
  ready when it exists, every webhook with a `clientConfig.service` has a
  non-empty `caBundle`, and every such Service has an EndpointSlice endpoint
  that is not `ready: false`. Webhooks addressed by `url` are skipped. The check
  uses `get` only and the shared `pollUntil`, so a missing configuration is
  retried and `kore status` bounds it like every other check.
- Failures name the webhook entry. A missing `caBundle` names the injector when
  the configuration carries a cert-manager `inject-ca-from` annotation (the
  OpenTelemetry operator, cert-manager), and otherwise says the owning
  controller has not injected it yet (Gatekeeper, Policy Controller, Istiod,
  External Secrets, CloudNativePG). A missing endpoint names `namespace/Service`.
- Catalog entries were taken from `helm template` of the pinned charts with the
  environment values: cert-manager, Gatekeeper, Policy Controller (four
  configurations), Istiod, External Secrets, CloudNativePG and the
  OpenTelemetry operator. Crossplane renders no webhook configuration, so it
  has none. Only configurations the pinned chart renders by default or the
  values enable are listed; an upgrade that renames one fails readiness
  visibly and is fixed with the pin.
- The Deployment rollout checks stay: they report the workload, these report
  admission.

## Refinement: a second reconcile of unchanged state upgrades nothing

A live second `kore local up` right after a fresh one upgraded six releases that
had not changed: `kore-image-policy`, `kore-local-tls`, `opa-authorizer` and
`kore-platform-config` (configuration phase) and the app releases
`reference-resources` and `reference`. The fingerprints were stable: the
platform releases carried the same description on revisions 1 and 2. The
fingerprint was never consulted. `platformUp` reconciled every configuration
component unconditionally, and `kore app up` never recorded a fingerprint (its
revisions read "Install complete" and "Upgrade complete").

- Configuration Helm releases use the same check as resume: a release deployed
  from the current fingerprint is awaited, not upgraded. The step that follows
  an apply (starting the local tunnel once the Gateway exists) runs either way,
  so a skipped upgrade cannot lose it. Configuration manifests are still applied
  on every run: a server-side apply is idempotent, their content is not
  fingerprinted, and skipping them because their CRDs exist (the resume rule)
  would hide a changed policy template.
- App releases fingerprint what kore hands Helm: the arguments (image digest,
  registry address, gateway and secret-store settings) and the chart's content,
  with the chart path made relative to the repository. The fingerprint is stored
  as the revision description. A new image digest therefore upgrades only the
  workload release; a changed gateway setting upgrades both.
- The hash covers only arguments and repository files. Credentials and keys are
  never Helm arguments, so none is hashed, printed or stored. A release that
  does not exist yet reads as drift (`release: not found`) rather than an error.
- Releases deployed before this change have no fingerprint and are upgraded once
  more, then are stable.
