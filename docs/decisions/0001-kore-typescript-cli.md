---
status: accepted
summary: Implement kore as a Node.js TypeScript executable that coordinates upstream tools and reads JSON-compatible YAML.
date: 2026-09-13
last-verified: 2026-11-07
---

# ADR 0001: Implement `kore` as a Node.js TypeScript executable

Source: [`infra/plans/2-implementation.md` § Step 6](../../infra/plans/2-implementation.md#step-6-repository-and-local-cluster-foundation)

## Context

Kore needs a cross-platform, testable command that coordinates Minikube, Helm,
OpenTofu, and kubectl. Lifecycle safety, dependency ordering, structured output,
and resumability would become difficult to maintain as shell scripts grow.

## Decision

Implement `kore` as a Node.js executable authored in TypeScript under
`tools/kore`. Keep desired state
in repository-owned catalogs, environment files, Helm charts, and Kubernetes
manifests. The executable coordinates upstream tools but does not reimplement
their reconciliation behavior.

Catalog and environment files use the JSON-compatible subset of YAML, making them
readable as YAML while allowing the freshly built command to validate them with
Node's built-in JSON parser and no runtime package dependencies.

## Consequences

The compiled command can be tested without a cluster, packaged as a small npm
artifact, and used consistently in CI. Adding YAML features outside the JSON
subset requires a deliberate parser dependency and an update to the schema
contract.
