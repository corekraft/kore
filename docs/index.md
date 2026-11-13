# Knowledge Index

One line per document: what it decides and when to read it. Start here when a
task needs the reasons behind the code, not just the code. Paths are from the
repository root; `mise run kb-check` keeps this list complete.

## Principles and Overview

- [`AGENTS.md`](../AGENTS.md) — the repository's rules, and which ones hooks
  enforce. Read at the start of any change.
- [`README.md`](../README.md) — what Kore does and how to run each `kore`
  command. Read before running or changing a command.
- [`GLOSSARY.md`](../GLOSSARY.md) — the canonical terms for the delivery loop,
  agent roles and self-improvement. Read before naming a domain, role or idea.
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
  the `guard` hook, or context hooks.
- [`infra/plans/7-cohesive-domain-classes.md`](../infra/plans/7-cohesive-domain-classes.md) —
  active: one cohesive class per domain responsibility, constructor-injected
  repository and runner, and the lint rules that enforce it. Read before
  restructuring a domain under `tools/kore/src`.
- [`infra/plans/8-harness-measurement.md`](../infra/plans/8-harness-measurement.md) —
  active: the `tools/harness` package, the stage-event ledger, and the flow
  report that names the delivery loop's bottleneck, with a baseline. Read before
  changing how sessions, panes or GitHub events are recorded.
- [`infra/plans/9-k3d-local-cluster.md`](../infra/plans/9-k3d-local-cluster.md) —
  active: replace Minikube with k3d and delete the tunnel domain. Read before
  changing the local cluster, image import, or local storage.
- [`infra/plans/10-tools-first-skills.md`](../infra/plans/10-tools-first-skills.md) —
  active: move deterministic skill and hook steps into the harness package and
  hold skills to a length budget. Read before writing or changing a skill or
  hook.
- [`infra/plans/11-agent-delivery-loop.md`](../infra/plans/11-agent-delivery-loop.md) —
  active: delivery on autopilot from idea to outcome, with role agents in Herdr
  panes, feature flags, and a safety-pattern judge. Read before changing agent
  roles, ideas, flags, or merging.
- [`infra/plans/12-self-improving-loop.md`](../infra/plans/12-self-improving-loop.md) —
  active: automatic retro, auto-approved and auto-reverted harness ideas, and
  guardrails that need approval to enforce. Read before changing retro or a
  guardrail.
- [`infra/plans/13-agentgateway-ingress.md`](../infra/plans/13-agentgateway-ingress.md) —
  active: agentgateway replaces Istio ingress on k3d, with ztunnel kept. Read
  before changing ingress or the Gateway.

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
- [`docs/decisions/0012-environment-overlays-hold-provider-specifics.md`](decisions/0012-environment-overlays-hold-provider-specifics.md) — local-cluster and provider specifics live only in environment overlays. Read when adding an environment or a provider setting.
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
- [`docs/decisions/0028-image-trust-authority.md`](decisions/0028-image-trust-authority.md) — refines 0015 and 0026: one validated per-environment trust authority (exact release identity or local key) rendered into a ClusterImagePolicy (only `release.yaml` on an exact tag signs; denial of other identities is tested offline and live). Read when changing who may sign or the image policy.
- [`docs/decisions/0029-local-export-and-restore.md`](decisions/0029-local-export-and-restore.md) — refines 0003: `kore data export|restore` dump retained CloudNativePG databases through age-encrypted, digest-manifested exports that `cluster destroy` trusts. Read when changing retained-data recovery.
- [`docs/decisions/0030-security-and-quality-scans.md`](decisions/0030-security-and-quality-scans.md) — pinned mise scanners (TruffleHog, OSV-Scanner, Semgrep, actionlint, zizmor, hadolint), CI gate, and ignore policy. Read when adding a scan or an ignore.
- [`docs/decisions/0031-registry-address-platform-variable.md`](decisions/0031-registry-address-platform-variable.md) — refines 0028 and 0012: one per-environment `registry.address` from which the registry Service pin, image policy glob, and push/sign/deploy references derive; local IP versus remote hostname. Read when changing where images are published or admitted.
- [`docs/decisions/0032-application-namespace-image-admission.md`](decisions/0032-application-namespace-image-admission.md) — refines 0028 and 0025: mandatory Sigstore namespace enrollment in `kore app up`, per-environment warn/enforce mode, and a separate static policy for upstream images the platform places in application namespaces. Read when changing admission enrollment or adding an upstream image.
- [`docs/decisions/0033-platform-image-mirror.md`](decisions/0033-platform-image-mirror.md) — refines 0028 and 0026: a tag-gated release job mirrors the approved platform images (the digest-pinned seeds plus `approved-images.yaml`) into `mirror/*`, verifies upstream provenance, signs and verifies the digests, and emits a platform image lock; every chart image is digest-pinned and an opt-in check enforces it. Read when changing the approved platform images or the release workflow.
- [`docs/decisions/0034-registry-authentication-and-authorization.md`](decisions/0034-registry-authentication-and-authorization.md) — refines 0015 and 0031: an nginx auth proxy sidecar gives the registry separate push and read-only identities that kore generates and streams as Secrets, drops the NodePort, and uses a TCP readiness probe. Read when changing how images are pushed, pulled, or exposed.
- [`docs/decisions/0035-fail-fast-readiness-diagnosis.md`](decisions/0035-fail-fast-readiness-diagnosis.md) — refines the fail-closed readiness gate: a read-only, namespace-scoped watcher cancels a running Helm or readiness wait on a fatal pod state and fails with the pod, container, state, previous logs, and a fix hint; a Deployment with no available replica (registry or verifier down) reads as degraded. Read when changing component install, readiness waits, or the Runner.
- [`docs/decisions/0036-rollout-feasibility-and-container-smoke.md`](decisions/0036-rollout-feasibility-and-container-smoke.md) — opt-in rollout-feasibility and container-smoke checks that catch crash-loops and unschedulable rollouts before live contact. Read when adding or changing a chart or its local values.
- [`docs/decisions/0044-managed-platform-images-from-the-mirror.md`](decisions/0044-managed-platform-images-from-the-mirror.md) — refines 0033 and 0031: `managed-example` declares a `platformMirror` and rewrites only each approved image's repository to it (digests stay single-owned), validate and an opt-in render test fail on a missing or drifted rewrite, the managed image policy admits the mirror under exact release subjects, and the release lock is attached to the GitHub release and checked by `kore validate --platform-image-lock`. Read when changing managed images, admission of the mirror, or the lock.
- [`docs/decisions/0054-application-admission-gate-closed-at-foundation.md`](decisions/0054-application-admission-gate-closed-at-foundation.md) — refines ADR 0004, 0027, 0032, 0015: the admission gate is one Gatekeeper constraint per environment, closed at the start of each run and opened by `platform up` only when every component is ready; only bootstrap automation writes it, activates namespaces, or reads the local signing key; `kore app up` refuses until it is open. Read when changing bootstrap, app up, namespace activation, or key access.
- [`docs/decisions/0055-registry-credential-rotation.md`](decisions/0055-registry-credential-rotation.md) — refines ADR 0034: `kore registry rotate-credentials --yes` rotates the push and read passwords and the enrolled pull Secrets in an order that keeps admission reading signatures; nginx needs no reload. Read when changing registry credentials.
- [`docs/decisions/0057-runtime-crd-ownership.md`](decisions/0057-runtime-crd-ownership.md) — refines ADR 0011: `ownsCRDGroups` lets a component own the CRDs its controller installs at runtime; validate rejects overlapping claims, and `kore platform status` reports unowned or multiply owned cluster CRDs as degraded (audit only). Read when adding a Function, provider, or constraint template.
- [`docs/decisions/0058-registry-transport-tls.md`](decisions/0058-registry-transport-tls.md) — refines ADR 0034: the registry proxy serves TLS only with a cert-manager certificate from a kore-owned CA; containerd, nerdctl, cosign, kore, and Policy Controller verify it and no plain-HTTP flag remains. Read when changing registry transport or clients.
- [`docs/decisions/0060-tunnel-recovery-on-demand.md`](decisions/0060-tunnel-recovery-on-demand.md) — superseded by ADR 0076: the k3d load balancer replaces the tunnel and the tunnel domain is deleted. Kept as history.
- [`docs/decisions/0059-identity-policy-evidence.md`](decisions/0059-identity-policy-evidence.md) — refines 0007, 0014, 0017, 0028: per-constraint promotion records with zero-violation audit evidence, signers trusted only if the environment's image policy lists them (never the local key in a managed environment), and offline/live proof of OPA bundle failure. Read when promoting a constraint or changing who may sign.
- [`docs/decisions/0056-platform-image-inventory.md`](decisions/0056-platform-image-inventory.md) — refines ADR 0033 and 0054: a read-only inventory of every running platform image and namespace enrollment, `audit` locally and `enforce` in managed environments (`environment.imageInventory`), reported in `platform status` and checked before the gate opens. Read when changing bootstrap success criteria, seeds, or image trust.
- [`docs/decisions/0063-lifecycle-resume-and-release-only-app-up.md`](decisions/0063-lifecycle-resume-and-release-only-app-up.md) — refines ADR 0005, 0015, 0054: `app up` accepts only a release-automation lock entry (`--image-lock`), source builds go through `kore local up`, every up clears and verifies failed or canceled releases without touching retained data, and `app status` reports the deployed digest, signer, registry, and enforcement. Read when changing app up, resume, or cleanup.
- [`docs/decisions/0066-opa-receives-peer-identity-via-xfcc.md`](decisions/0066-opa-receives-peer-identity-via-xfcc.md) — refines 0014, 0059: OPA gets the authenticated caller principal from a waypoint-synthesized x-forwarded-client-cert (Gateway annotation), and third-party controller namespaces are exempt from the container-security constraint. Read when changing OPA input, waypoints, or that exemption list.
- [`docs/decisions/0070-recovery-objectives-and-offline-ops-checks.md`](decisions/0070-recovery-objectives-and-offline-ops-checks.md) — refines ADR 0029: recovery objectives live in infra/catalog/recovery.yaml, `kore ops` checks inventory, upgrades, and CRDs offline, and scheduled backups stay managed-only until a live restore proves them. Read when adding stateful data, a backup, or an upgrade gate.
- [`docs/decisions/0073-digest-required-admission.md`](decisions/0073-digest-required-admission.md) — refines ADR 0028: Policy Controller resolves tag-only images instead of refusing them, so a dryrun `kore-image-digest` Gatekeeper constraint requires @sha256 pins, and the reference smoke spec reads its token from the cluster Secret. Read when changing image admission or live-spec credentials.
- [`docs/decisions/0072-constraint-promotion-procedure.md`](decisions/0072-constraint-promotion-procedure.md) — refines ADR 0059: `kore policy record|promote|rollback` change one Gatekeeper constraint through the repository from recorded audit evidence, with a tested rollback and an opt-in live round trip. Read when promoting or reverting a constraint.
- [`docs/decisions/0074-backup-freshness-row.md`](decisions/0074-backup-freshness-row.md) — refines ADR 0070 and 0029: the export is the local backup, the RPO is the schedule, and an audit-only `backups` status row reports staleness. Read when changing backups or `platform status` rows.
- [`docs/decisions/0062-telemetry-proofs-and-mesh-identity.md`](decisions/0062-telemetry-proofs-and-mesh-identity.md) — refines ADR 0019: ztunnel scraped for mesh identity, Grafana trace/log links, offline telemetry specs plus one opt-in live spec. Read when changing telemetry proofs or mesh metrics.
- [`docs/decisions/0061-retained-volumes-are-discovered-by-storage-class.md`](decisions/0061-retained-volumes-are-discovered-by-storage-class.md) — refines 0020: retained-data discovery also lists kore-retained PersistentVolumes, so a deleted retained claim's Released volume still blocks destroy. Read when changing retained-data discovery.
- [`docs/decisions/0065-restart-readiness-and-transient-kubectl-retry.md`](decisions/0065-restart-readiness-and-transient-kubectl-retry.md) — refines 0035: after a cluster start kore waits for /readyz and a Ready node before any apply, and one runner layer retries mutating kubectl commands on transient stderr with bounded backoff and in-memory stdin replay. Read when changing cluster start, kubectl retries, or readiness waits.
- [`docs/decisions/0067-platform-readiness-manifest-and-evidence.md`](decisions/0067-platform-readiness-manifest-and-evidence.md) — refines ADR 0054 and 0056: a versioned readiness manifest, evidence recorded before the gate opens, `platform gate-check` that only closes, controllers exempt while closed, promotion to deny left to the live gate spec. Read when changing what opens the gate.
- [`docs/decisions/0075-token-source-has-one-owner-and-rotation-rolls-consumers.md`](decisions/0075-token-source-has-one-owner-and-rotation-rolls-consumers.md) — refines ADR 0009: the cluster's reference token source is created once and never overwritten by another checkout, `secrets sync --rotate --yes` replaces it, and a one-way rotation marker in the pod template rolls consumers. Read when changing token or secret-source handling.
- [`docs/decisions/0076-k3d-replaces-minikube.md`](decisions/0076-k3d-replaces-minikube.md) — refines ADRs 0012, 0015, 0060 and 0065: the local environment runs on k3d; its load balancer replaces the tunnel, local-path replaces minikube-hostpath, and Kore keeps its own registry. Read when changing the local cluster.
- [`docs/decisions/0077-live-proof-gates-activation-not-merge.md`](decisions/0077-live-proof-gates-activation-not-merge.md) — refines "It just works": every change declares a safety pattern, and live proof gates turning a flagged change on, not merging it, except for cluster-facing no-behaviour-change changes. Read when changing merge rules or feature flags; the contributor guide has the activation steps.
- [`docs/decisions/0078-agent-roles-run-as-herdr-panes.md`](decisions/0078-agent-roles-run-as-herdr-panes.md) — each delivery-loop role is an agent definition with its default tier, launched in its own Herdr pane by one parameterized claude command, in bypass mode bounded by guards. Read when adding a role or changing tiers.
- [`docs/decisions/0079-idea-and-outcome-records.md`](decisions/0079-idea-and-outcome-records.md) — an idea is a markdown record in docs/ideas that owns content and outcome, mirrored one way to a GitHub issue that owns workflow state. Read when changing ideas, outcomes, or the issue sync.
- [`docs/decisions/0080-guardrails-change-freely-activate-with-approval.md`](decisions/0080-guardrails-change-freely-activate-with-approval.md) — refines "Audit before enforce": harness ideas are auto-approved when reversible and measurable, and a changed guardrail lands in audit mode until a person approves enforcing it. Read before changing a guardrail.
- [`docs/decisions/0081-agentgateway-replaces-istio-ingress.md`](decisions/0081-agentgateway-replaces-istio-ingress.md) — refines ADR 0006: agentgateway serves Gateway API ingress, Istio ambient ztunnel keeps identity and mTLS, and the resource saving is measured afterwards. Read when changing ingress.
- [`docs/decisions/0082-harness-package-bundled-for-skills.md`](decisions/0082-harness-package-bundled-for-skills.md) — refines ADR 0001: harness tools are a TypeScript package at tools/harness, bundled to skills/bin/harness.mjs (no longer committed, ADR 0092), talking to kore only through its CLI output. Read before adding a harness tool or hook.
- [`docs/decisions/0083-k3d-publishes-through-the-node-containerd-client.md`](decisions/0083-k3d-publishes-through-the-node-containerd-client.md) — refines ADR 0034 and 0015: on k3d, publish with the node's `ctr` through `docker exec`, credential on stdin held in a tmpfs hosts.toml, no node shell. Read before changing the k3d push path.
- [`docs/decisions/0084-k3d-registry-trust-through-a-mounted-ca-directory.md`](decisions/0084-k3d-registry-trust-through-a-mounted-ca-directory.md) — refines ADRs 0058 and 0076: on k3d nodes trust the registry CA through a registries.yaml and a host CA directory mounted at create, with a restart fallback. Read when changing registry trust on k3d.
- [`docs/decisions/0085-k3d-gateway-answers-through-a-node-port.md`](decisions/0085-k3d-gateway-answers-through-a-node-port.md) — refines ADRs 0016 and 0076: on k3d the Gateway Service is a NodePort set by the overlay, the load balancer maps the host port to it, and readiness accepts an assigned node port. Read when changing how the local Gateway is published.
- [`docs/decisions/0086-resources-only-releases-do-not-wait-on-claims-that-bind-later.md`](decisions/0086-resources-only-releases-do-not-wait-on-claims-that-bind-later.md) — A resources-only release that holds a WaitForFirstConsumer claim sets helm.wait false so Helm does not wait for the bind; the consumer's own readiness check proves the volume.
- [`docs/decisions/0087-cosign-reads-the-pinned-kubeconfig-from-a-file-descriptor.md`](decisions/0087-cosign-reads-the-pinned-kubeconfig-from-a-file-descriptor.md) — Kore feeds the pinned kubeconfig to cosign from memory as KUBECONFIG=/dev/fd/N, so embedded k3d credentials never touch disk and the refusal of embedded credentials is no longer needed.
- [`docs/decisions/0088-provider-owned-crd-groups.md`](decisions/0088-provider-owned-crd-groups.md) — refines ADR 0057: an environment declares `providerOwnedCRDGroups` (k3s's `k3s.cattle.io`, `helm.cattle.io` on k3d) and `crd-ownership` counts them as provider-owned. Read when a provider ships CRDs no component owns.
- [`docs/decisions/0089-declarative-probe-patches-through-a-helm-post-renderer.md`](decisions/0089-declarative-probe-patches-through-a-helm-post-renderer.md) — A component's catalog patches set integer probe fields a chart gives no value for, applied by a repository-kept Helm post-renderer plugin so render and upgrade show the same output.
- [`docs/decisions/0090-the-main-ruleset-stays-active-and-audit-rules-sync-into-a-candidate-ruleset.md`](decisions/0090-the-main-ruleset-stays-active-and-audit-rules-sync-into-a-candidate-ruleset.md) — Main stays active permanently; a ruleset rule in audit mode syncs into a separate main-candidate ruleset in evaluate, promotion moves approved rules into main as active after a dry run and --confirm, and sync stops without changes when GitHub refuses evaluate on the plan.
- [`docs/decisions/0091-containment-comes-from-identities-and-a-sandbox-not-role-guards.md`](decisions/0091-containment-comes-from-identities-and-a-sandbox-not-role-guards.md) — Refines ADR 0078 and 0080: agent containment comes from separate GitHub identities, no owner bypass and an OS sandbox; regex role guards are hints, frozen apart from quick fixes.
- [`docs/decisions/0092-the-harness-bundle-is-a-build-output-not-a-committed-file.md`](decisions/0092-the-harness-bundle-is-a-build-output-not-a-committed-file.md) — skills/bin/harness.mjs is no longer committed: CI and release build it, a launcher loads it and fails closed when absent, and the merge driver and freshness check go.
- [`docs/decisions/0093-the-nightly-live-proof-runs-on-a-dedicated-self-hosted-runner-under-bounded-timeouts.md`](decisions/0093-the-nightly-live-proof-runs-on-a-dedicated-self-hosted-runner-under-bounded-timeouts.md) — A nightly job proves clean local up and the integration suites on a dedicated host, commands get a read and a mutation timeout, and the runner choice stays an open owner decision.
- [`docs/decisions/0094-writer-panes-run-under-macos-sandbox-exec-with-a-writer-token-over-https.md`](decisions/0094-writer-panes-run-under-macos-sandbox-exec-with-a-writer-token-over-https.md) — Refines ADR 0091: a writer pane runs under sandbox-exec that confines writes to its worktree and denies credential reads and the herdr socket; a container is the fallback; it is not a containment boundary until the writer identity exists.

## Proposed Decisions

None of these is implemented. They are direction for the vision, not binding
decisions; read one only when planning that area, and expect it to change.

- [`docs/decisions/0037-tenant-isolation-by-namespace.md`](decisions/0037-tenant-isolation-by-namespace.md) — tenants share one cluster, isolated per service environment namespace by mesh, network policy, quotas, and admission; no Capsule; vCluster is a later dedicated tier. Read when changing tenant namespaces or isolation.
- [`docs/decisions/0038-organization-hierarchy-depth-and-labels.md`](decisions/0038-organization-hierarchy-depth-and-labels.md) — organizations nest at most four levels below the tenant root; namespaces carry only tenant and organization labels. Read when changing the `Organization` API or namespace labels.
- [`docs/decisions/0039-service-sharing-by-owner-grant.md`](decisions/0039-service-sharing-by-owner-grant.md) — services are shared within a tenant only by owner grant, which parents can block; only operators grant across tenants. Read when changing service-to-service access.
- [`docs/decisions/0040-keycloak-human-identity.md`](decisions/0040-keycloak-human-identity.md) — each tenant root gets its own Keycloak, composed by the `Organization` API, with one realm and nested groups per sub-organization. Read when changing sign-in or group-based access.
- [`docs/decisions/0041-backstage-and-argo-cd-per-tenant.md`](decisions/0041-backstage-and-argo-cd-per-tenant.md) — refines ADR 0002 and 0011 for tenant workloads: one Backstage and one namespace-scoped Argo CD per tenant root, scoped by organization. Read when changing the portal or tenant delivery.
- [`docs/decisions/0042-organization-domains-by-delegation.md`](decisions/0042-organization-domains-by-delegation.md) — organizations delegate zones under any TLD to the platform's DNS, services are subdomains inside them, and each organization gets one default zone under a per-environment platform domain. Read when changing hostnames, DNS, or certificates.
- [`docs/decisions/0043-platform-configuration-through-argo-cd.md`](decisions/0043-platform-configuration-through-argo-cd.md) — refines ADR 0002, 0011, 0016, and 0027: `kore` keeps the bootstrap, core, and observability phases; the platform Argo CD owns the configuration phase except the image policy, as Helm charts from the platform OCI registry, and its health gates admission. Read when changing phases, release owners, or the platform Argo CD.
- [`docs/decisions/0045-static-frontends-as-signed-images.md`](decisions/0045-static-frontends-as-signed-images.md) — static frontends are served in the cluster from signed static-server images on the same host as their BFF; external hosting is a recorded escape hatch. Read when changing frontend delivery.
- [`docs/decisions/0046-bff-jvm-with-agent-and-aot-cache.md`](decisions/0046-bff-jvm-with-agent-and-aot-cache.md) — refines ADR 0015: the Kotlin BFF runs on the GraalVM JDK as a JVM with the OpenTelemetry Java agent, starting from a build-time AOT cache in its Jib image. Read when changing the BFF template or its build.
- [`docs/decisions/0047-autoscaling-metrics-server-then-keda.md`](decisions/0047-autoscaling-metrics-server-then-keda.md) — metrics-server first as a catalog Helm release, CPU autoscaling defaults in chart values without a replica count, KEDA later. Read when changing autoscaling.
- [`docs/decisions/0048-data-service-tenancy-tiers.md`](decisions/0048-data-service-tenancy-tiers.md) — per-claim instances for PostgreSQL, document, and key-value stores; shared, partitioned Kafka and object store; dedicated stores per tenant root on approval. Read when changing a data service API.
- [`docs/decisions/0049-data-store-implementations.md`](decisions/0049-data-store-implementations.md) — SeaweedFS, Strimzi, FerretDB on CloudNativePG, and Valkey for local data services, with no Bitnami images. Read when adding or changing a data store.
- [`docs/decisions/0050-tenant-telemetry-isolation.md`](decisions/0050-tenant-telemetry-isolation.md) — refines ADR 0010 and 0019: shared backends, a Grafana per tenant, multi-tenant Loki and Tempo, a label-enforcing proxy for Prometheus, Mimir later. Read when changing telemetry access.
- [`docs/decisions/0051-telemetry-retention-and-alerting.md`](decisions/0051-telemetry-retention-and-alerting.md) — refines ADR 0019: default and per-tenant retention, tenant alerts in each tenant's Grafana, Alertmanager for platform alerts only. Read when changing retention or alerting.
- [`docs/decisions/0052-usage-metering-with-opencost.md`](decisions/0052-usage-metering-with-opencost.md) — usage per organization through OpenCost and platform counters, for visibility only. Read when changing usage reporting.
- [`docs/decisions/0053-forensic-telemetry-archive.md`](decisions/0053-forensic-telemetry-archive.md) — refines ADR 0019, 0050, and 0051: every log record and span kept unsampled in a Quickwit archive on the object store, buffered through Kafka, fully indexed, write-once, with signed batch digests and audited, tenant-scoped access. Read when changing telemetry retention, sampling, or the archive.

## Operations and Guides

- [`docs/guides/operator.md`](guides/operator.md) — running the local platform: start, stop, status, and where each recurring task is documented. Read first when operating Kore.
- [`docs/guides/contributor.md`](guides/contributor.md) — the change loop: tests first, the checks to run, where each kind of change lives, and feature flag activation. Read before your first change.
- [`docs/guides/troubleshooting.md`](guides/troubleshooting.md) — symptom to cause to fix, by status row and error. Read when a command or the platform fails.
- [`docs/guides/application-onboarding.md`](guides/application-onboarding.md) — the contract an application meets and the steps to deploy one. Read before adding an application.
- [`docs/operations/support-and-upgrades.md`](operations/support-and-upgrades.md) — support window, upgrade order, rollback, and the gaps. Read before upgrading a pin or Kore.
- [`docs/operations/registry.md`](operations/registry.md) — registry backup, restore, recovery objectives, garbage collection, signature retention, and the digest policy. Read when the registry or its data is lost or full.
- [`docs/operations/signing-and-keys.md`](operations/signing-and-keys.md) — signing identities, key and identity rotation, compromise response, pipeline controls, and break-glass. Read when changing who may sign.
- [`docs/operations/trust-and-rotation.md`](operations/trust-and-rotation.md) — every trust root, certificate and secret rotation, and workload identity incident response. Read when rotating or revoking anything.
- [`docs/operations/policy-changes.md`](operations/policy-changes.md) — policy review, audit-to-enforce promotion, rollback, and emergency exemptions. Read when changing or promoting a policy.
- [`docs/operations/resource-budgets.md`](operations/resource-budgets.md) — profile sizing and the `capacity` status warning. Read when the platform runs short of CPU or memory.
- [`docs/operations/backups.md`](operations/backups.md) — the export backup target, the RPO objective, and the audit-only `backups` status row. Read when exporting, restoring, or when `backups` is degraded.

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
- [`docs/release-signer-controls.md`](release-signer-controls.md) — what pins the
  accepted Cosign signer to the release workflow on a tag, what the repository
  checks, and the GitHub settings (tag and `main` rulesets, token defaults) to verify with
  read-only `gh api`. Read when changing release workflows or signing trust.
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
- [`.claude/agents/concierge.md`](../.claude/agents/concierge.md) and
  [`reader.md`](../.claude/agents/reader.md) — the delivery loop's read-only
  role agents; their tier is the only copy
  ([ADR 0078](decisions/0078-agent-roles-run-as-herdr-panes.md)). Their bounds
  are the `role-*` guard rules in `tools/harness/src/hook/guard-role.ts`.
- [`.github/pull_request_template.md`](../.github/pull_request_template.md) —
  the PR body, with the one `Safety pattern:` field and the linked idea that
  `harness judge precheck <pr>` reads before it reads the diff, and
  `harness judge merge <pr>` re-runs before it squash-merges. Read when
  opening a PR or changing the judge's precheck or merge tool.
- [`.claude/evals/`](../.claude/evals/) — skill-triggering, review and role
  boundary evals (`--kind boundary`, opt-in). Read when changing a skill
  description, the review agent or a role's bounds.

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
