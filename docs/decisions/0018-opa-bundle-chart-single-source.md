---
status: accepted
summary: The OPA authorizer chart carries a copy of the tested bundle under bundle/, templates it into a ConfigMap with .Files, and loads it with opa --bundle; a test fails when the copy drifts from bundles/v1.
date: 2026-11-08
last-verified: 2026-11-08
---

# ADR 0018: Deploy the tested OPA bundle from the chart

Source: [`infra/plans/2-implementation.md` § Step 9](../../infra/plans/2-implementation.md#step-9-workload-identity-application-image-trust-and-policy)

Refines: [ADR 0014](0014-native-identity-before-opa.md)

## Context

The deployed policy was an inline copy in the chart that differed from the
tested `bundles/v1`, and `bundle.url` pointed at a server nothing deployed.

## Decision

- Helm cannot read outside a chart, so `infra/charts/opa-authorizer/bundle/`
  holds a copy of the deployable bundle files (`.manifest`, `policy.rego`,
  `mask.rego`). A spec compares them byte for byte with
  `infra/policies/opa/bundles/v1` and fails on drift.
- The chart templates them into one ConfigMap through `.Files.Get`, mounts each
  file with `subPath`, and starts OPA with `--bundle /bundle`. OPA then enforces
  the manifest roots and rejects a bundle whose packages fall outside them.
  A checksum annotation restarts pods when the bundle changes.
- No HTTP or OCI bundle server is deployed; `bundle.url` is removed. A served,
  signed bundle is a later option once release automation exists.
- Decision logs go to the console as JSON. `mask.rego` (package `system.log`,
  in the bundle roots) erases credential headers and bodies before export.

## Consequences

Stale-bundle detection by polling does not exist because bundles are not
polled; a changed bundle rolls the pods. Invalid-bundle behavior is OPA's load
failure, so the pod never becomes ready and the Istio provider stays
`failOpen: false`. The Collector still needs a log receiver to ingest the
console output (Step 11).
