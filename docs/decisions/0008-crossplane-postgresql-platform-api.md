---
status: accepted
summary: Applications claim PostgreSQL through a namespaced Crossplane PostgreSQLInstance API with portable inputs and a fixed connection Secret schema, composed locally by CloudNativePG.
date: 2026-09-12
last-verified: 2026-11-08
---

# ADR 0008: Expose PostgreSQL as a namespaced Crossplane platform API

Source: [`infra/plans/1-initialize.md` § Platform API and PostgreSQL](../../infra/plans/1-initialize.md#platform-api-and-postgresql)

## Context

The reference application needs PostgreSQL locally and must later move to
managed PostgreSQL without code or chart changes. A generic database API would
hide engine differences behind a contract nobody can fully honor.

## Decision

- Crossplane v2 defines a namespaced `PostgreSQLInstance.platform.kore.dev`
  API, not a generic database API.
- The API exposes only portable inputs: service class, storage size,
  connection Secret name, PostgreSQL compatibility version, and retention
  policy. Provider settings stay in environment compositions.
- The local composition creates a CloudNativePG cluster; a provider composition
  may create managed PostgreSQL. Both publish the same connection Secret schema
  and readiness contract.
- The claim lives in the application resources release; the composed database
  is owned by Crossplane, not Helm.

## Consequences

Applications read connection data only from the normalized Secret. Crossplane
needs RBAC to compose CloudNativePG resources. A managed composition must match
the local readiness and Secret interface before a provider is supported.
