---
status: accepted
summary: Each application has separate resources and workload releases, stateful data is retained by default, and deletion needs an explicit purge.
date: 2026-09-12
last-verified: 2026-11-08
---

# ADR 0003: Separate claims from workloads and retain data by default

Source: [`infra/plans/1-initialize.md` § Application Lifecycle](../../infra/plans/1-initialize.md#application-lifecycle),
[§ Command Behavior](../../infra/plans/1-initialize.md#command-behavior), and
[§ Storage and Retention](../../infra/plans/1-initialize.md#storage-and-retention)

## Context

Applications request databases, Secrets, and storage that outlive any single
workload revision. If claims and workloads share a release, removing or
replacing a workload can silently delete persistent infrastructure and data.

## Decision

- An application named `example` has two Helm releases:
  `example-resources` for its infrastructure claims and retention policy, and
  `example` for its ServiceAccount, workload, Service, routes, telemetry
  configuration, and authorization policy references. The resources release is
  ready before the workload release begins.
- Every stateful claim declares an explicit retention policy.
- The platform exposes two storage profiles: `kore-standard` for disposable
  data and `kore-retained` with a `Retain` reclaim policy.
- Removing an application or stopping a local platform retains persistent
  resources. Deleting data requires a separate, explicit `--purge-data`
  operation.
- Destroying a local cluster that holds retained data is refused unless the data
  is purged or a verified export exists.
- Destructive commands require interactive confirmation, or an explicit
  confirmation flag when non-interactive.

## Consequences

Workloads can be replaced or removed without touching their data. Lifecycle
guards need retained-data discovery. Retention is not a backup; backup and
restore are required before the platform is production-ready.
