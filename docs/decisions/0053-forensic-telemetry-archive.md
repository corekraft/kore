---
status: proposed
summary: Beside the hot telemetry tier, every log record and span is kept unsampled in a forensic archive, buffered through Kafka and indexed by Quickwit on the object store with full-text search over messages and attributes, in write-once buckets with signed batch digests, per-tenant indexes, retention, and audited access.
date: 2026-11-09
last-verified: 2026-11-09
---

# ADR 0053: Keep a forensic telemetry archive in Quickwit on the object store

Source: [`docs/vision.md` § Observability Out of the Box](../vision.md#observability-out-of-the-box)

Refines: [ADR 0019](0019-telemetry-pipeline-wiring.md),
[ADR 0050](0050-tenant-telemetry-isolation.md), and
[ADR 0051](0051-telemetry-retention-and-alerting.md).

## Context

The hot tier (Prometheus, Loki, and Tempo) keeps days of telemetry for
dashboards, alerts, and debugging. Incident response, audits, and disputes need
complete telemetry kept for much longer, searchable by any message text or
attribute, and provably unaltered. Loki indexes only labels and Tempo searches a
subset of attributes, so neither gives a full index over long periods. Quickwit
indexes OpenTelemetry logs and traces, message text and attributes alike, and
keeps both its indexes and the data on object storage. It is licensed under
Apache 2.0, with no commercial-use restriction.

## Decision

- **Two tiers.** The hot tier is unchanged. A forensic archive keeps every log
  record and every span with its full body and attributes.
- **Nothing is sampled away from the archive.** Mesh tracing samples every
  request, and the Collector sends all spans to the archive even where the hot
  tier samples.
- **The Collector writes twice, through a durable buffer.** The Collector
  buffers to disk and exports every signal to the hot tier and, through a Kafka
  topic per tenant, to the archive, so an indexer outage loses nothing and the
  archive can be replayed.
- **Quickwit indexes the archive on the object store.** Quickwit, pinned to an
  exact version, reads the Kafka topics and writes one index per tenant root
  into the object store
  ([ADR 0049](0049-data-store-implementations.md)), shared or the tenant's
  dedicated store ([ADR 0048](0048-data-service-tenancy-tiers.md)). Every
  message and attribute is searchable.
- **Tamper-evident.** Archive buckets are created with S3 Object Lock and
  versioning enabled and a default retention in COMPLIANCE mode, which
  SeaweedFS documents as refusing deletion or change by any user, root
  included, until retention ends. Each indexed batch has a digest that is
  signed and recorded, as
  data exports are ([ADR 0029](0029-local-export-and-restore.md)). Gaps in the
  sequence are detected and reported.
- **Secrets never enter.** The Collector strips secrets and tokens before
  either tier, and tenants can add their own masking rules for personal data.
- **Tenant-scoped and audited.** A tenant searches only its own index, through
  its own Grafana ([ADR 0050](0050-tenant-telemetry-isolation.md)). Every
  archive search is logged, and operator access goes through a logged
  break-glass path.
- **Retention per tenant, with legal hold.** Each tenant sets its archive
  retention within its quota, a legal hold blocks deletion, and each tenant's
  archive lives in its own bucket encrypted with SSE-KMS under its own key, so
  destroying the key destroys the archive.

## Consequences

- Keeping every span multiplies telemetry volume; archive storage and ingest
  count toward each tenant's usage
  ([ADR 0052](0052-usage-metering-with-opencost.md)).
- Kafka, the object store, and Quickwit become prerequisites of the telemetry
  pipeline, so they must be installed before the observability phase.
- Object Lock can be enabled only when a bucket is created, so the
  `Organization` API creates each tenant's archive bucket with it from the
  start.
- SeaweedFS's enforcement of COMPLIANCE mode is documented, not yet proven: a
  test must show that deleting or overwriting a locked object is refused
  before the archive is trusted.
- Quickwit deletes splits when it merges them or applies retention. In a
  versioned bucket that adds a delete marker and the locked version stays
  until its retention ends, so merged data costs storage twice for the lock
  period, and deleted splits remain recoverable as evidence. Quickwit's
  behaviour against a locked bucket is tested before implementation.
- Per-tenant SSE-KMS keys need a key service. SeaweedFS supports AWS KMS,
  Google Cloud KMS, and OpenBao or Vault; locally that means OpenBao, which
  Plan 1 deferred, so adding it needs its own ADR.
- Metrics are not archived here; long-term metrics come with Mimir.
- Quickwit enters the catalog with its own readiness checks and compatibility
  evidence, and its release activity is reviewed at each upgrade.
