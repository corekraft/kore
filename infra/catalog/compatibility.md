# MVP compatibility matrix

Validated offline on 2026-11-07. Live conformance remains an opt-in live
test and is required before a release is tagged. **The live bootstrap test has
not been run against these pins and is still required.**

Target Kubernetes minor: 1.37 (the Kubernetes of the pinned k3s image,
whose patch is 1.37.2). Offline evidence per row: the chart renders with the
repository values and the CRDs the catalog says the component owns are present.
Kubernetes 1.37 support below is what upstream publishes; it is not yet proven
on a live cluster.

| Component                        | Pinned version           | Date       | Kubernetes contract                                                                                                                                                                                                       |
| -------------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes                       | 1.37.2                   | 2026-11-07 | k3s image `v1.37.2-k3s1` release                                                                                                                                                                                          |
| k3d                              | 5.9.0                    | 2026-11-11 | Local cluster tool for plan 9; mise-pinned and mirrored in `versions.yaml`; proven live in #149 (2026-11-12): every opt-in suite, four fresh and three existing-profile `kore local up` runs                              |
| k3s image                        | rancher/k3s:v1.37.2-k3s1 | 2026-11-11 | Same Kubernetes 1.37.2 as kubectl; pinned by index digest (see note); evidence below; proven live in #149 (2026-11-12) with the same suites                                                                               |
| Helm                             | 4.3.1                    | 2026-11-07 | Chart rendering and release client                                                                                                                                                                                        |
| OpenTofu provider hashicorp/null | 3.2.4                    | 2026-11-09 | Offline `tofu validate` of `infra/tofu/stacks/managed-example` only; no credentials, never applied; OpenTofu 1.13.9                                                                                                       |
| Gateway API                      | 1.7.0                    | 2026-11-07 | Standard channel, `gateway.networking.k8s.io/v1`; 1.7 breaking changes are experimental-only                                                                                                                              |
| cert-manager                     | 1.21.3                   | 2026-11-07 | Gateway API certificate integration enabled; patch release                                                                                                                                                                |
| Gatekeeper                       | 3.23.1                   | 2026-11-07 | `templates.gatekeeper.sh/v1`; already latest stable chart (3.24.0 is beta only)                                                                                                                                           |
| Sigstore Policy Controller chart | 0.10.8                   | 2026-11-07 | `policy.sigstore.dev` CRDs (`clusterimagepolicies`, `trustroots`); `deployment/policy-controller-webhook`; audit-only (see note)                                                                                          |
| Istio                            | 1.31.4                   | 2026-11-07 | Ambient profile, Gateway API, Kubernetes 1.37; charts from `blob.istio.io` (see note)                                                                                                                                     |
| agentgateway chart               | v1.7.0                   | 2026-11-11 | `cr.agentgateway.dev/charts/agentgateway`; cataloged as `agentgateway` behind feature `ingress-agentgateway` (off); `deployment/agentgateway` renders with the common values; not installed by any environment (see note) |
| agentgateway CRDs chart          | v1.7.0                   | 2026-11-11 | `agentgateway-crds` owns the four `agentgateway.dev` CRDs (the main chart ships none); same feature flag; Gateway API CRDs stay owned by `kore-gateway-api`                                                               |
| agentgateway images              | v1.7.0                   | 2026-11-11 | Controller and data plane pinned by index digest, cosign keyless signature verified, mirrored by name (see note)                                                                                                          |
| Crossplane                       | 2.4.3                    | 2026-11-07 | Namespaced v2 composite resources; patch release                                                                                                                                                                          |
| function-go-templating           | v0.13.2                  | 2026-11-07 | Composition pipeline function for `infra/apis/postgresql`, installed by `kore-crossplane-functions`                                                                                                                       |
| function-auto-ready              | v0.7.3                   | 2026-11-07 | Composition pipeline function for `infra/apis/postgresql`, installed by `kore-crossplane-functions`                                                                                                                       |
| External Secrets                 | 2.14.0                   | 2026-11-07 | `external-secrets.io/v1`                                                                                                                                                                                                  |
| CloudNativePG chart              | 0.29.1                   | 2026-11-07 | PostgreSQL operator API v1; patch release                                                                                                                                                                                 |
| OpenTelemetry Operator           | 0.129.0                  | 2026-11-07 | Collector custom resources and target allocator                                                                                                                                                                           |
| OpenTelemetry Collector chart    | 0.178.2                  | 2026-11-07 | `deployment/otel-collector` renders with `infra/observability/collector/values.yaml`                                                                                                                                      |
| Prometheus chart                 | 29.45.1                  | 2026-11-07 | `deployment/prometheus-server` renders with the local values                                                                                                                                                              |
| promtool                         | 3.16.0                   | 2026-11-08 | Offline `promtool check rules` and `promtool test rules` for `infra/observability/config` (`mise run test-promtool`)                                                                                                      |
| Loki chart                       | 7.5.0                    | 2026-11-07 | `statefulset/loki` renders in SingleBinary mode with the local values                                                                                                                                                     |
| Tempo chart                      | 1.24.4                   | 2026-11-07 | Already latest stable; `statefulset/tempo`                                                                                                                                                                                |
| Grafana chart                    | 10.5.15                  | 2026-11-07 | Already latest stable; `deployment/grafana`                                                                                                                                                                               |
| OCI registry image               | registry:3.1.2           | 2026-11-08 | `deployment/oci-registry` renders; distribution 3.1.2 has no config-breaking changes; pinned by index digest (see note)                                                                                                   |
| OCI registry proxy image         | 1.31.7-alpine3.24        | 2026-11-08 | `deployment/oci-registry` renders with the `proxy` container; pinned by index digest; basic-auth and method rules are validated live (ADR 0034)                                                                           |
| Policy Controller image          | v0.13.1                  | 2026-11-08 | Webhook image the chart 0.10.8 deploys (app 0.13.1); pinned by index digest via `policy-controller.yaml` values                                                                                                           |
| Policy Controller kubectl image  | latest-dev               | 2026-11-08 | `leasescleanup` Job image in chart 0.10.8; the chart default is a floating tag, so a digest override is required                                                                                                          |
| Cosign CLI                       | 3.1.4                    | 2026-11-08 | Offline `cosign verify` of internal digests (`kore app` image verification); mise-pinned and mirrored in `versions.yaml`; live signing/verification is validated on the bootstrap path, not offline                       |
| crane CLI                        | 0.22.1                   | 2026-11-08 | Release-workflow `crane digest`/`crane copy` of approved platform images by digest (ADR 0033); mise-pinned and mirrored in `versions.yaml`; live mirroring is untested until the first tagged run                         |
| gator CLI                        | 3.23.1                   | 2026-11-08 | Same release as the Gatekeeper chart; `test-gatekeeper` runs the constraint template suites offline                                                                                                                       |
| TruffleHog                       | 3.99.7                   | 2026-11-08 | `mise run scan-secrets`: git history and tracked files, verified + unknown + unverified results; `.kore/` and SOPS ciphertext excluded via `.trufflehog-exclude`; verification needs network                              |
| OSV-Scanner                      | 2.7.0                    | 2026-11-08 | `mise run scan-vulns`: npm lockfiles against the OSV database (network); container images are not scanned (see ADR 0030)                                                                                                  |
| Semgrep                          | 1.182.1                  | 2026-11-08 | `mise run scan-sast`: committed rules in `infra/policies/semgrep` only, no registry, no metrics; rule tests via `scan-sast-test`                                                                                          |
| actionlint                       | 1.7.12                   | 2026-11-08 | `mise run scan-workflows`: workflow syntax and expression checks, offline                                                                                                                                                 |
| zizmor                           | 1.31.1                   | 2026-11-08 | `mise run scan-workflows`: workflow security audit (`--offline`, regular persona), SHA pinning and permissions                                                                                                            |
| hadolint                         | 2.15.1                   | 2026-11-08 | `mise run scan-dockerfiles`: Dockerfile lint for `apps/reference`                                                                                                                                                         |
| OPA Envoy image                  | 1.22.2-envoy             | 2026-11-07 | `opa-authorizer` renders; same OPA release as the toolchain CLI; policies pass `test-opa`                                                                                                                                 |
| Reference base image             | node:26.13.0-alpine3.24  | 2026-11-07 | Latest Node LTS on Alpine                                                                                                                                                                                                 |

k3s `v1.37.2-k3s1` (pinned by tag and index digest `sha256:21ea6e0fac4e3930c2ce8aa40ddd41a8b18cb3e9a0222c030dc005e7e88c4332`, resolved with `crane digest` on 2026-11-11, in `versions.yaml` `images.k3s`; k3d
5.9.0 is the latest k3d release, resolved 2026-11-11) tracks the same upstream
Kubernetes 1.37.2 as the pinned kubectl. Evidence per component
against that version, all unchanged pins. Live evidence: #149 ran every opt-in
live suite and `kore local up` on k3d 5.9.0 with this k3s image on
2026-11-12, and every component below converged (plan 9 Results has the suite
table and machine load). A live bootstrap is still required before a release is
tagged:

| Component         | Version | Evidence against k3s v1.37.2                                                             |
| ----------------- | ------- | ---------------------------------------------------------------------------------------- |
| kubectl           | 1.37.2  | Identical Kubernetes version, so well inside kubectl's one-minor skew policy             |
| Helm              | 4.3.1   | Chart rendering and release client; Kubernetes API version is the same as the k3s image  |
| Gateway API       | 1.7.0   | Standard-channel CRDs are applied by Kore, not bundled by k3s; k3s ships no Gateway CRDs |
| cert-manager      | 1.21.3  | Uses stable core APIs only; no distribution-specific dependency                          |
| Gatekeeper        | 3.23.1  | Admission webhooks and `templates.gatekeeper.sh/v1` are distribution-independent         |
| Policy Controller | 0.10.8  | `policy.sigstore.dev` webhooks and CRDs are distribution-independent                     |

k3s bundles Traefik, ServiceLB, metrics-server and local-path storage; the
cluster lifecycle step (plan 9 Step 2) disables the bundled ones Kore owns,
so one tool owns each resource.

Sigstore Policy Controller (chart 0.10.8, app 0.13.1; the newest chart on
https://sigstore.github.io/helm-charts, which lags the 0.15.1 application
release) is installed with no `ClusterImagePolicy` and no namespace labelled
`policy.sigstore.dev/include=true`. Its webhooks only select labelled
namespaces, so nothing is enforced yet (audit before enforce). Enforcement and
namespace enrollment are later work.

Image digests (resolved 2026-11-08 with `docker buildx imagetools inspect`,
read-only; the digest is the multi-arch OCI index, covering linux/amd64 and
linux/arm64):

| Image                                                  | Tag        | Index digest                                                              |
| ------------------------------------------------------ | ---------- | ------------------------------------------------------------------------- |
| `docker.io/library/registry`                           | 3.1.2      | `sha256:38907510915c3f1604c7e83d6ab602ab3020d092f73bdaed8696773693ff768c` |
| `ghcr.io/sigstore/policy-controller/policy-controller` | v0.13.1    | `sha256:0bcd60beb93f4427c29cf3a669743caf58490e98ded4380c33c09f092734a6ab` |
| `cgr.dev/chainguard/kubectl`                           | latest-dev | `sha256:3562a8854a81a77e39eb34cd87106345d1122432f88d74ea2dd4c9595883c033` |

`helm template` of chart 0.10.8 honors the overrides: the webhook renders as
`...policy-controller:v0.13.1@sha256:0bcd...` and the lease-cleanup Job as
`...kubectl:latest-dev@sha256:3562...`. The chart's own webhook default was already
the same digest (untagged); the lease-cleanup default was the floating
`latest-dev` tag. `latest-dev` is a moving upstream tag, so the digest is the
real pin; a Policy Controller upgrade must re-resolve it. The live bootstrap is
still required before a release is tagged.

Istio 1.31 stops publishing to `istio-release.storage.googleapis.com`; the
catalog now uses `https://blob.istio.io/istio-release/charts`. Istio 1.31 also
sends unhealthy endpoints by default; this repository sets no outlier
detection, so no values change.

All pins are centralized in `versions.yaml`. A controller upgrade must render
offline, pass CRD ownership tests, and pass the live bootstrap test before the
matrix is changed.

agentgateway v1.7.0 (chart and images, resolved 2026-11-11) is cataloged and
pinned but not installed: `agentgateway-crds` and `agentgateway` carry
`featureFlag: ingress-agentgateway`, which is off in `local` and
`managed-example` (ADR 0081, plan 13 Step 1). Both charts come from
`oci://cr.agentgateway.dev/charts`. `agentgateway-crds` (bootstrap phase) owns
`agentgatewaybackends`, `agentgatewaymodels`, `agentgatewayparameters` and
`agentgatewaypolicies` (`agentgateway.dev`); the main chart (core phase,
namespace `agentgateway-system`) renders no CRDs, and depends on
`agentgateway-crds`, `kore-gateway-api` and `cert-manager`. Gateway API
1.7.0 CRDs stay owned by `kore-gateway-api`; the chart's RBAC names only the
standard `gateway.networking.k8s.io` group, and upstream states no Gateway API
minimum, so conformance against 1.7.0 is proven by the install ticket. Istio
1.31.4 ambient coexistence: the chart's `istio.enabled` (default true) only
grants RBAC to read Istio `ServiceEntry` and `WorkloadEntry`; `istio.autoEnabled`
stays false, so no Gateway joins the mesh unless it opts in through
`AgentgatewayParameters`. Istio keeps ztunnel for identity and mTLS. k3d and
Kubernetes 1.37 evidence is added by the live run of the agentgateway install
ticket (#205); offline, the flag-on install order (`kore-gateway-api`,
`cert-manager`, `agentgateway-crds`, `agentgateway`), the readiness wait on
`deployment/agentgateway`, the fail-fast naming of an unready controller and a
rerun that changes no release are proven by `RecordingRunner` specs, and the
live evidence row is still open. Namespace treatment of `agentgateway-system`:
enrolled in image admission by default (no `enrollmentExemptions` entry);
`KoreContainerSecurity` covers it (no exemption); `KoreMeshEnrollment` covers it
too (no exemption). Helm's `--create-namespace` leaves the namespace
unlabelled, so the catalog marks the `agentgateway` component `meshEnrolled` and
`kore platform up` applies `istio.io/dataplane-mode: ambient` to its namespace
once the flag is on, in every inventory mode, as server-side-apply field manager
`kore-mesh-enrollment` (released again when the flag is off). Specs prove the
label is applied with the flag on and never with it off, and Gatekeeper fixtures
prove a labelled namespace has 0 violations and an unlabelled one has 1. The
live run (#149) proves the label on the cluster and the gateway with ztunnel,
and records which rules the chart's pods violate in `dryrun`.

| Image                              | Tag    | Index digest                                                              | Signature                                                                                 |
| ---------------------------------- | ------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `cr.agentgateway.dev/controller`   | v1.7.0 | `sha256:87c1363bf0cbc7fdb375866e592294114c8763097d2d0c9fc45fcb1fe00a4ab8` | keyless, `agentgateway/agentgateway` `release.yml@refs/tags/v1.7.0` (GitHub Actions OIDC) |
| `cr.agentgateway.dev/agentgateway` | v1.7.0 | `sha256:60216aafb03d37f94e952ff3d51d2f630a65b10ecaebdc0a864882f92610c45b` | keyless, same workflow and tag                                                            |

`agentgateway.yaml` sets `controller.image.tag` and `proxy.image.tag` to
`v1.7.0@sha256:...`: the chart renders the controller image with that tag, and
passes the proxy tag to the controller as `AGW_PROXY_IMAGE_TAG`, which the
controller uses for every data plane it deploys. Whether the controller accepts
a digest in that tag when it creates a data plane is unproven offline and is
checked by the install ticket. The `managed-example` overlay rewrites both to the
platform mirror (`agentgateway-controller`, `agentgateway-proxy`). The live
bootstrap is still required before a release is tagged.
