# Knowledge Index

One line per document: what it decides and when to read it. Start here when a
task needs the reasons behind the code, not just the code. Paths are from the
repository root; `mise run kb-check` keeps this list complete.

## Principles and Overview

- [`AGENTS.md`](../AGENTS.md) — the repository's rules, and which ones hooks
  enforce. Read at the start of any change.
- [`README.md`](../README.md) — what Kore does and how to run each `kore`
  command. Read before running or changing a command.
- [`docs/vision.md`](vision.md) — where Kore is going: a multi-tenant
  business and developer platform of organizations, sub-organizations, and
  services on their own domains, with static frontends, autoscaled backends for
  frontend, org-scoped data services and telemetry, and Backstage and Argo CD
  out of the box. Read before planning work beyond Plan 2. Rendered as a
  page in [`docs/vision.html`](vision.html).

## Plans

- [`infra/plans/1-initialize.md`](../infra/plans/1-initialize.md) — done:
  architecture, lifecycle, capabilities, tool selection, and repository
  topology. Read when a change touches platform shape or a tool choice.
- [`infra/plans/2-implementation.md`](../infra/plans/2-implementation.md) —
  active: implementation Steps 6–15, with work items and exit criteria. Read
  for the step you are implementing and the steps after it.
- [`infra/plans/3-agent-harness.md`](../infra/plans/3-agent-harness.md) — done:
  hooks, deny rules, skills, evals, and the retrospective log. Read before
  changing anything under `.claude/` or `skills/`.
- [`infra/plans/4-knowledge.md`](../infra/plans/4-knowledge.md) — done: this
  index, document frontmatter, upward links, and `kb-check`. Read before adding
  or restructuring documents.
- [`infra/plans/5-self-maintenance.md`](../infra/plans/5-self-maintenance.md) —
  done: CI, a deterministic retrospective scan, skill pruning and rule
  promotion, eval history, and stale-document checks. Read before changing CI,
  `retro`, `eval.mjs`, or `kb-check`.
- [`infra/plans/6-agent-primitives.md`](../infra/plans/6-agent-primitives.md) —
  done: an operations journal `kore` owns, an append-only guard, and a hook
  that reports what changed between turns. Read before changing the runner,
  `guard.mjs`, or context hooks.
- [`infra/plans/7-cohesive-domain-classes.md`](../infra/plans/7-cohesive-domain-classes.md) —
  active: one cohesive class per domain responsibility, constructor-injected
  repository and runner, and the lint rules that enforce it. Read before
  restructuring a domain under `tools/kore/src`.

## Decisions

- [`docs/decisions/0001-kore-typescript-cli.md`](decisions/0001-kore-typescript-cli.md) — `kore` is a Node.js TypeScript executable using the standard library. Read before adding a dependency or another language.
- [`docs/decisions/0002-tool-responsibility-boundaries.md`](decisions/0002-tool-responsibility-boundaries.md) — OpenTofu owns the substrate, Helm in-cluster software, controllers claims; `kore` only coordinates. Read before making `kore` manage a resource.
- [`docs/decisions/0003-separate-claims-and-retain-data.md`](decisions/0003-separate-claims-and-retain-data.md) — apps keep resources and workload as separate releases; data is retained unless purged. Read when changing app charts or teardown.
- [`docs/decisions/0004-fail-closed-application-admission-gate.md`](decisions/0004-fail-closed-application-admission-gate.md) — phased bootstrap opens app admission only after every prerequisite is ready. Read when changing bootstrap order or readiness.
- [`docs/decisions/0005-release-automation-signed-image-trust.md`](decisions/0005-release-automation-signed-image-trust.md) — only digest-pinned images signed by release automation are admitted. Read when touching image build, signing, or admission.
- [`docs/decisions/0006-istio-ambient-gateway-api.md`](decisions/0006-istio-ambient-gateway-api.md) — Istio ambient implements Gateway API, mesh, and identity; cert-manager issues certificates. Read when changing networking or TLS.
- [`docs/decisions/0007-workload-identity-and-layered-authorization.md`](decisions/0007-workload-identity-and-layered-authorization.md) — ServiceAccount identities, native Istio policy, then fail-closed OPA. Read when changing authorization.
- [`docs/decisions/0008-crossplane-postgresql-platform-api.md`](decisions/0008-crossplane-postgresql-platform-api.md) — apps claim PostgreSQL through a portable Crossplane API, composed locally by CloudNativePG. Read when changing the database API.
- [`docs/decisions/0009-encrypted-secrets-through-external-secrets.md`](decisions/0009-encrypted-secrets-through-external-secrets.md) — apps reference secrets through ExternalSecret; SOPS with age locally, never plaintext on disk. Read before touching secrets.
- [`docs/decisions/0010-opentelemetry-collector-ingestion.md`](decisions/0010-opentelemetry-collector-ingestion.md) — apps send OTLP only to the Collector, which exports to Prometheus, Loki, and Tempo. Read when changing telemetry.
- [`docs/decisions/0011-catalog-owned-releases-and-versions.md`](decisions/0011-catalog-owned-releases-and-versions.md) — the catalog declares every release, owner, dependency, readiness check, and version. Read when adding a component.
- [`docs/decisions/0012-environment-overlays-hold-provider-specifics.md`](decisions/0012-environment-overlays-hold-provider-specifics.md) — Minikube and provider specifics live only in environment overlays. Read when adding an environment or a provider setting.
- [`docs/decisions/0013-local-tls-before-gateway.md`](decisions/0013-local-tls-before-gateway.md) — refines 0006: the local certificate gets its own release before the Gateway. Read when debugging local Gateway readiness.
- [`docs/decisions/0014-native-identity-before-opa.md`](decisions/0014-native-identity-before-opa.md) — refines 0007: Istio checks caller identity because ExtAuthz omits principals. Read when changing OPA policy.
- [`docs/decisions/0015-local-signed-image-delivery.md`](decisions/0015-local-signed-image-delivery.md) — refines 0005: local images are signed with a local key and deployed by digest. Read when changing `local up` or image delivery.
- [`docs/decisions/0016-release-readiness-checks-drive-wait-and-status.md`](decisions/0016-release-readiness-checks-drive-wait-and-status.md) — Catalog readiness checks are mandatory and drive both bootstrap waits and status. Read when changing readiness, webhook readiness or status.
- [`docs/decisions/0017-gatekeeper-policy-families-audit-first.md`](decisions/0017-gatekeeper-policy-families-audit-first.md) — Gatekeeper RBAC, Secret, mesh, and retention rules ship in dryrun, tested with gator. Read when changing admission policy.
- [`docs/decisions/0018-opa-bundle-chart-single-source.md`](decisions/0018-opa-bundle-chart-single-source.md) — refines 0014: the chart deploys the tested bundle, with a drift test and masked decision logs. Read when changing OPA delivery.
- [`docs/decisions/0019-telemetry-pipeline-wiring.md`](decisions/0019-telemetry-pipeline-wiring.md) — gateway Collector plus node agent, config chart owns rules and dashboards, metric attribute allowlist. Read when changing telemetry wiring.
- [`docs/decisions/0020-postgresql-api-scoped-rbac-status-and-retention.md`](decisions/0020-postgresql-api-scoped-rbac-status-and-retention.md) — refines 0008: scoped Crossplane Secret access, projected database status, labeled retained PVCs, app down reports retained data. Read when changing the PostgreSQL API.
- [`docs/decisions/0021-render-redaction-and-portability-rendering.md`](decisions/0021-render-redaction-and-portability-rendering.md) — Portability renders app charts with defaults only; rendered platform output redacts Secret values. Read when changing render or portability checks.
- [`docs/decisions/0023-crossplane-functions-own-release-and-readiness.md`](decisions/0023-crossplane-functions-own-release-and-readiness.md) — refines 0008 and 0016: Functions are their own release; readiness waits for Installed and Healthy. Read when changing Crossplane Functions or function readiness.
- [`docs/decisions/0024-reference-app-database-access.md`](decisions/0024-reference-app-database-access.md) — refines 0008: std-lib SCRAM PostgreSQL client, secretKeyRef password, authenticated readiness, hook-Job migrations. Read when changing how the reference app reaches its database.
- [`docs/decisions/0025-application-namespace-ambient-enrollment.md`](decisions/0025-application-namespace-ambient-enrollment.md) — refines 0017: `kore app up` owns application namespaces and labels them ambient; Gatekeeper audits it. Read when changing namespace creation or mesh enrollment.
- [`docs/decisions/0026-seed-manifest.md`](decisions/0026-seed-manifest.md) — refines 0015: `infra/catalog/seeds.yaml` records every seed image with reason and upstream evidence; `kore validate` rejects unrecorded ones. Read when adding or upgrading an image on the registry or verifier path.
- [`docs/decisions/0027-bootstrap-installs-controllers-and-image-trust-only.md`](decisions/0027-bootstrap-installs-controllers-and-image-trust-only.md) — refines 0004, 0008, 0014: bootstrap installs controllers and image trust only; the PostgreSQL API and OPA authorizer are configuration phase. Read when changing bootstrap scope or phases.
- [`docs/decisions/0028-image-trust-authority.md`](decisions/0028-image-trust-authority.md) — refines 0015 and 0026: one validated per-environment trust authority (exact release identity or local key) rendered into a ClusterImagePolicy; no namespace enrolled. Read when changing who may sign or the image policy.
- [`docs/decisions/0029-local-export-and-restore.md`](decisions/0029-local-export-and-restore.md) — refines 0003: `kore data export|restore` dump retained CloudNativePG databases through age-encrypted, digest-manifested exports that `cluster destroy` trusts. Read when changing retained-data recovery.
- [`docs/decisions/0030-security-and-quality-scans.md`](decisions/0030-security-and-quality-scans.md) — pinned mise scanners (TruffleHog, OSV-Scanner, Semgrep, actionlint, zizmor, hadolint), CI gate, and ignore policy. Read when adding a scan or an ignore.
- [`docs/decisions/0031-registry-address-platform-variable.md`](decisions/0031-registry-address-platform-variable.md) — refines 0028 and 0012: one per-environment `registry.address` from which the registry Service pin, image policy glob, and push/sign/deploy references derive; local IP versus remote hostname. Read when changing where images are published or admitted.
- [`docs/decisions/0032-application-namespace-image-admission.md`](decisions/0032-application-namespace-image-admission.md) — refines 0028 and 0025: mandatory Sigstore namespace enrollment in `kore app up`, per-environment warn/enforce mode, and a separate static policy for upstream images the platform places in application namespaces. Read when changing admission enrollment or adding an upstream image.
- [`docs/decisions/0033-platform-image-mirror.md`](decisions/0033-platform-image-mirror.md) — refines 0028 and 0026: a tag-gated release job mirrors the approved platform images (the digest-pinned seeds plus `approved-images.yaml`) into `mirror/*`, verifies upstream provenance, signs and verifies the digests, and emits a platform image lock; every chart image is digest-pinned and an opt-in check enforces it. Read when changing the approved platform images or the release workflow.
- [`docs/decisions/0034-registry-authentication-and-authorization.md`](decisions/0034-registry-authentication-and-authorization.md) — refines 0015 and 0031: an nginx auth proxy sidecar gives the registry separate push and read-only identities that kore generates and streams as Secrets, drops the NodePort, and uses a TCP readiness probe. Read when changing how images are pushed, pulled, or exposed.
- [`docs/decisions/0035-fail-fast-readiness-diagnosis.md`](decisions/0035-fail-fast-readiness-diagnosis.md) — refines the fail-closed readiness gate: a read-only, namespace-scoped watcher cancels a running Helm or readiness wait on a fatal pod state and fails with the pod, container, state, previous logs, and a fix hint. Read when changing component install, readiness waits, or the Runner.
- [`docs/decisions/0036-rollout-feasibility-and-container-smoke.md`](decisions/0036-rollout-feasibility-and-container-smoke.md) — opt-in rollout-feasibility and container-smoke checks that catch crash-loops and unschedulable rollouts before live contact. Read when adding or changing a chart or its local values.
- [`docs/decisions/0037-tenant-isolation-by-namespace.md`](decisions/0037-tenant-isolation-by-namespace.md) — tenants share one cluster, isolated per service environment namespace by mesh, network policy, quotas, and admission; no Capsule; vCluster is a later dedicated tier. Read when changing tenant namespaces or isolation.
- [`docs/decisions/0038-organization-hierarchy-depth-and-labels.md`](decisions/0038-organization-hierarchy-depth-and-labels.md) — organizations nest at most four levels below the tenant root; namespaces carry only tenant and organization labels. Read when changing the `Organization` API or namespace labels.
- [`docs/decisions/0039-service-sharing-by-owner-grant.md`](decisions/0039-service-sharing-by-owner-grant.md) — services are shared within a tenant only by owner grant, which parents can block; only operators grant across tenants. Read when changing service-to-service access.
- [`docs/decisions/0040-keycloak-human-identity.md`](decisions/0040-keycloak-human-identity.md) — each tenant root gets its own Keycloak, composed by the `Organization` API, with one realm and nested groups per sub-organization. Read when changing sign-in or group-based access.
- [`docs/decisions/0041-backstage-and-argo-cd-per-tenant.md`](decisions/0041-backstage-and-argo-cd-per-tenant.md) — refines ADR 0002 and 0011 for tenant workloads: one Backstage and one namespace-scoped Argo CD per tenant root, scoped by organization. Read when changing the portal or tenant delivery.
- [`docs/decisions/0042-organization-domains-by-delegation.md`](decisions/0042-organization-domains-by-delegation.md) — organizations delegate zones under any TLD to the platform's DNS, services are subdomains inside them, and each organization gets one default zone under a per-environment platform domain. Read when changing hostnames, DNS, or certificates.
- [`docs/decisions/0043-platform-configuration-through-argo-cd.md`](decisions/0043-platform-configuration-through-argo-cd.md) — refines ADR 0002, 0011, 0016, and 0027: `kore` keeps the bootstrap, core, and observability phases; the platform Argo CD owns the configuration phase except the image policy, and its health gates admission. Read when changing phases, release owners, or the platform Argo CD.

## Reference

- [`infra/catalog/versions.yaml`](../infra/catalog/versions.yaml) — the pinned
  version of every tool, chart, controller, and provider. Read when a version
  matters; never copy versions elsewhere.
- [`infra/catalog/components.yaml`](../infra/catalog/components.yaml) — the
  platform components: phase, source, CRD ownership, dependencies, and readiness.
  Read when adding or reordering a component.
- [`infra/catalog/schemas/`](../infra/catalog/schemas/) — JSON Schemas for the
  catalogs. Read when a catalog fails validation.
- [`infra/catalog/compatibility.md`](../infra/catalog/compatibility.md) —
  compatibility evidence for the pinned versions. Read when upgrading a pin.
- [`infra/catalog/images.lock.json`](../infra/catalog/images.lock.json) — the
  release image lock, by digest. Read when deploying or signing an image; local
  builds never edit it.
- [`infra/environments/schema.json`](../infra/environments/schema.json) — the
  environment overlay schema. Read when adding an environment or its settings.
- [`infra/apis/postgresql/tests/contract.md`](../infra/apis/postgresql/tests/contract.md)
  — what the PostgreSQL platform API guarantees to applications. Read when
  changing the API or its compositions.
- [`infra/tofu/modules/README.md`](../infra/tofu/modules/README.md) — why
  OpenTofu modules are empty until a managed provider is chosen.
- [`infra/environments/local/secrets/README.md`](../infra/environments/local/secrets/README.md)
  — how local secrets are generated and encrypted. Read before touching
  secrets.

## Agent Harness

- [`.claude/settings.json`](../.claude/settings.json) — hook wiring, allow and
  deny rules. Read before adding a hook or permission.
- [`.claude/agents/principles-review.md`](../.claude/agents/principles-review.md)
  — the read-only review of a diff against AGENTS.md. Run before committing.
- [`.claude/evals/`](../.claude/evals/) — skill-triggering and review evals.
  Read when changing a skill description or the review agent.

## Skills

- [`skills/add-command/SKILL.md`](../skills/add-command/SKILL.md) — adding or
  changing a `kore` command, subcommand, or flag.
- [`skills/add-policy/SKILL.md`](../skills/add-policy/SKILL.md) — adding or
  changing an OPA/Rego or Gatekeeper policy.
- [`skills/handoff/SKILL.md`](../skills/handoff/SKILL.md) — ending a thread
  before its plan step is finished.
- [`skills/pin-upgrade/SKILL.md`](../skills/pin-upgrade/SKILL.md) — upgrading or
  adding a pinned version.
- [`skills/retro/SKILL.md`](../skills/retro/SKILL.md) — reviewing recent
  sessions and proposing harness changes.
- [`skills/spawn-session/SKILL.md`](../skills/spawn-session/SKILL.md) — starting
  a verifier or fixer session in a Herdr pane.
- [`skills/test-driven-development/SKILL.md`](../skills/test-driven-development/SKILL.md)
  — writing the failing test first for any code or hook change.
- [`skills/write-adr/SKILL.md`](../skills/write-adr/SKILL.md) — recording an
  architectural decision.
