---
status: proposed
summary: The PostgreSQL composition becomes a chart that receives database-routes, the platform domain and the organization identifier only while the flag is on, so each database gets a certificate from the local CA and a name, and the flag-off render stays byte-identical.
date: 2026-11-19
last-verified: 2026-11-19
---

# ADR 0137: The PostgreSQL composition becomes a chart that takes database routes behind database-routes

Source: [GitHub issue #1222](https://github.com/corekraft/kore/issues/1222), under #1195 (databases by name) and #1191; refines [ADR 0043](0043-platform-configuration-through-argo-cd.md), which hands `kore-postgresql-api` to Argo CD as a manifest release.

Defers to this step: [ADR 0136](0136-the-shared-gateway-serves-database-routes-on-a-loopback-5432-passthrough-listener-behind-database-routes.md) names the composition's certificate and route as later work. The TLSRoute that attaches a database to the `postgres` listener is not part of this decision.

## Context

The composition in `infra/apis/postgresql/compositions/local.yaml` is a raw
manifest component (`kore-postgresql-api`, owner `argocd`). Its Go templates
read only the claim, so they cannot read a feature flag, and they cannot read
the platform domain or the organization identifier that every other chart gets
through `platformHelmArgs`. Crossplane's `crossplane-postgresql-composition`
ClusterRole grants CloudNativePG Clusters and nothing else, so the composition
cannot create a certificate. Its connection Secret always reports `sslmode:
require`.

The name each database gets follows the platform's one derivation,
`<service>.<organizationId>.<domain>` (`platformPlan`, ADR 0042). The composition
has no way to take that derivation from the environment today, so a copy in the
manifest would be a second source.

## Decision

- **The composition is a chart, gated by its values.** `kore-postgresql-api`
  becomes a chart whose templates render the composition. It receives the
  database-routes gate, the platform domain and the organization identifier
  only while `database-routes` is on, through `platformHelmArgs`, following
  `sharedGatewayArgs`: no argument is passed while the flag is off. The flag-off
  render is byte-identical to the manifests it replaces, and a test asserts it.
- **The rendered name is the composite's name.** `<database>` is the composite's
  `metadata.name`, the same value that names the CloudNativePG Cluster and its
  `-rw` Service. The host is `<database>.<organizationId>.<domain>`, derived
  from `platformPlan`. Two databases with the same name in different namespaces
  collide on that host. The name is unique per organization, not per namespace,
  and a later step must refuse the second claim.
- **Certificate RBAC is a chart value.** `crossplane-postgresql-composition`
  gains `cert-manager.io` `certificates` with the same verbs as the CloudNativePG
  Clusters, and no Secret rule. The rule renders only with `databaseRoutes` on,
  which kore sets only while `database-routes` is on, so the flag-off role is
  unchanged. Cert-manager writes the certificate's Secret; CloudNativePG reads it
  in the database's own namespace (ADR 0061 keeps Crossplane out of Secrets).
- **The certificate is issued by the local CA.** The composition emits a
  cert-manager `Certificate` from the `kore-local-ca` ClusterIssuer (the
  `issuer.name` of the platform configuration). Its DNS names are the `-rw`,
  `-ro` and `-r` Service names and the derived host. CloudNativePG reads it
  through `spec.certificates.serverTLSSecret` and `serverCASecret`, which the
  pinned operator defines (chart 0.29.1, operator 1.30.1). The Secret carries the
  `cnpg.io/reload` label so a renewed certificate reloads without a restart.
- **The connection Secret keeps its six keys.** With the flag off it is exactly
  as before. With the flag on, three keys are added: `externalHost` (the derived
  host), `externalPort` (`5432`) and `externalSslmode` (`verify-full`). The
  in-cluster `host` and `sslmode` do not change, so in-cluster consumers keep
  working. The Secret carries no CA; a client trusts the local CA through the
  mkcert root the guide names.
- **Postgres 16 is reported, not refused.** A database on Postgres 16 gets a
  `ClaimConditions` entry of type `ReachableByName`, status `False`, reason
  `UnsupportedVersion`, target `CompositeAndClaim`, and a message that says the
  database is not reachable by name and to use the port forward. It appears only
  with the flag on. It does not reuse `DatabaseHealthy`, and the XRD does not
  change.

## Consequences

- Argo CD installs this release from the published `platform-charts.lock.json`.
  Changing it to a chart changes its content hash, so the chart-lock drift check
  refuses `kore local up` until a release with the new chart is published. The
  change to `kore-postgresql-api` therefore needs that publication before it
  merges to a live environment.
- `kore-postgresql-rbac` stays owned by `kore`, so slice 1 changes only the Helm
  path.
- A `database` name shared by two namespaces collides on its host. This is
  recorded here so a later step refuses it rather than discovering it live.
- The flag stays off in every overlay (ADR 0136). Turning it on needs a recorded
  live-run outcome for `database-routes`, as before.
