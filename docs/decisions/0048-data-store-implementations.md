---
status: accepted
summary: Local data services use SeaweedFS for the S3 object store, Strimzi for Kafka, FerretDB on CloudNativePG with the DocumentDB extension for the MongoDB protocol, and Valkey for the Redis protocol, all open source and avoiding Bitnami images.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0048: Implement local data services with SeaweedFS, Strimzi, FerretDB, and Valkey

Source: [`docs/vision.md` § Data Services, Scoped to the Organization](../vision.md#data-services-scoped-to-the-organization)

## Context

Applications see protocols (S3, Kafka, MongoDB, Redis); each environment picks
the implementation. Plan 1 prefers open-source tools and records exceptions.
The MongoDB server is licensed under the SSPL and Redis under RSALv2, SSPL, or
AGPLv3. Local implementations must run on Minikube and be operated from the
repository.

## Decision

- **Object store: SeaweedFS.** It is Apache 2.0, light enough for Minikube,
  installed from its Helm chart, and supports per-bucket S3 identities. Rook
  Ceph was too heavy for local use, and Garage covers less of the S3 API.
- **Kafka: Strimzi.** Topics and users are Kubernetes resources, which fits
  organization-prefixed topics and per-service ACLs
  ([ADR 0047](0047-data-service-tenancy-tiers.md)).
- **Document store: FerretDB on CloudNativePG.** FerretDB serves the MongoDB
  wire protocol on PostgreSQL with the DocumentDB extension, so the document
  store reuses the PostgreSQL platform
  ([ADR 0008](0008-crossplane-postgresql-platform-api.md)).
- **Key-value store: Valkey,** BSD licensed, speaking the Redis protocol.
- **No Bitnami images.** Charts and images come from each project or another
  pinned source, not Bitnami's catalog, whose free images Broadcom moved in 2025.
- **Upstream MongoDB or Redis is an exception** that needs its own ADR.

## Consequences

- FerretDB needs a PostgreSQL image with the DocumentDB extension, pinned,
  signed, and recorded like every other image, and its MongoDB compatibility
  gaps are documented for services.
- SeaweedFS's S3 coverage is checked against what services need before the
  object store API is published.
- The Valkey operator or chart is chosen and pinned during implementation.
- Each implementation enters the catalog with its own readiness checks and
  compatibility evidence.
