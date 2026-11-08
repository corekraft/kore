---
status: accepted
summary: Catalog readiness entries are mandatory, and the same read-only checks drive both bootstrap waits and platform status, with failures naming the component, resource, condition, and reason.
date: 2026-11-08
last-verified: 2026-11-08
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
  (get, wait, rollout status; never apply) with a 3s bound per check and
  reports `degraded` with the first failing check. Status writes no journal
  entry.
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
- Status uses a fixed bound; making it configurable is deferred.

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
