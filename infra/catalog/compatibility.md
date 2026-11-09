# MVP compatibility matrix

Validated offline on 2026-11-07. Live conformance remains an opt-in integration
test and is required before a release is tagged. **The live bootstrap test has
not been run against these pins and is still required.**

Target Kubernetes minor: 1.37 (the newest minor supported by Minikube 1.39,
whose newest supported patch is 1.37.2). Offline evidence per row: the chart renders with the
repository values and the CRDs the catalog says the component owns are present.
Kubernetes 1.37 support below is what upstream publishes; it is not yet proven
on a live cluster.

| Component                        | Pinned version          | Date       | Kubernetes contract                                                                                                                                                                                 |
| -------------------------------- | ----------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes                       | 1.37.2                  | 2026-11-07 | Minikube 1.39 supported release                                                                                                                                                                     |
| Helm                             | 4.3.1                   | 2026-11-07 | Chart rendering and release client                                                                                                                                                                  |
| OpenTofu provider hashicorp/null | 3.2.4                   | 2026-11-09 | Offline `tofu validate` of `infra/tofu/stacks/managed-example` only; no credentials, never applied; OpenTofu 1.13.9                                                                                 |
| Gateway API                      | 1.7.0                   | 2026-11-07 | Standard channel, `gateway.networking.k8s.io/v1`; 1.7 breaking changes are experimental-only                                                                                                        |
| cert-manager                     | 1.21.3                  | 2026-11-07 | Gateway API certificate integration enabled; patch release                                                                                                                                          |
| Gatekeeper                       | 3.23.1                  | 2026-11-07 | `templates.gatekeeper.sh/v1`; already latest stable chart (3.24.0 is beta only)                                                                                                                     |
| Sigstore Policy Controller chart | 0.10.8                  | 2026-11-07 | `policy.sigstore.dev` CRDs (`clusterimagepolicies`, `trustroots`); `deployment/policy-controller-webhook`; audit-only (see note)                                                                    |
| Istio                            | 1.31.4                  | 2026-11-07 | Ambient profile, Gateway API, Kubernetes 1.37; charts from `blob.istio.io` (see note)                                                                                                               |
| Crossplane                       | 2.4.3                   | 2026-11-07 | Namespaced v2 composite resources; patch release                                                                                                                                                    |
| function-go-templating           | v0.13.2                 | 2026-11-07 | Composition pipeline function for `infra/apis/postgresql`, installed by `kore-crossplane-functions`                                                                                                 |
| function-auto-ready              | v0.7.3                  | 2026-11-07 | Composition pipeline function for `infra/apis/postgresql`, installed by `kore-crossplane-functions`                                                                                                 |
| External Secrets                 | 2.14.0                  | 2026-11-07 | `external-secrets.io/v1`                                                                                                                                                                            |
| CloudNativePG chart              | 0.29.1                  | 2026-11-07 | PostgreSQL operator API v1; patch release                                                                                                                                                           |
| OpenTelemetry Operator           | 0.129.0                 | 2026-11-07 | Collector custom resources and target allocator                                                                                                                                                     |
| OpenTelemetry Collector chart    | 0.178.2                 | 2026-11-07 | `deployment/otel-collector` renders with `infra/observability/collector/values.yaml`                                                                                                                |
| Prometheus chart                 | 29.45.1                 | 2026-11-07 | `deployment/prometheus-server` renders with the local values                                                                                                                                        |
| promtool                         | 3.16.0                  | 2026-11-08 | Offline `promtool check rules` and `promtool test rules` for `infra/observability/config` (`mise run test-promtool`)                                                                                |
| Loki chart                       | 7.5.0                   | 2026-11-07 | `statefulset/loki` renders in SingleBinary mode with the local values                                                                                                                               |
| Tempo chart                      | 1.24.4                  | 2026-11-07 | Already latest stable; `statefulset/tempo`                                                                                                                                                          |
| Grafana chart                    | 10.5.15                 | 2026-11-07 | Already latest stable; `deployment/grafana`                                                                                                                                                         |
| OCI registry image               | registry:3.1.2          | 2026-11-08 | `deployment/oci-registry` renders; distribution 3.1.2 has no config-breaking changes; pinned by index digest (see note)                                                                             |
| OCI registry proxy image         | 1.31.7-alpine3.24       | 2026-11-08 | `deployment/oci-registry` renders with the `proxy` container; pinned by index digest; basic-auth and method rules are validated live (ADR 0034)                                                     |
| Policy Controller image          | v0.13.1                 | 2026-11-08 | Webhook image the chart 0.10.8 deploys (app 0.13.1); pinned by index digest via `policy-controller.yaml` values                                                                                     |
| Policy Controller kubectl image  | latest-dev              | 2026-11-08 | `leasescleanup` Job image in chart 0.10.8; the chart default is a floating tag, so a digest override is required                                                                                    |
| Cosign CLI                       | 3.1.4                   | 2026-11-08 | Offline `cosign verify` of internal digests (`kore app` image verification); mise-pinned and mirrored in `versions.yaml`; live signing/verification is validated on the bootstrap path, not offline |
| crane CLI                        | 0.22.1                  | 2026-11-08 | Release-workflow `crane digest`/`crane copy` of approved platform images by digest (ADR 0033); mise-pinned and mirrored in `versions.yaml`; live mirroring is untested until the first tagged run   |
| gator CLI                        | 3.23.1                  | 2026-11-08 | Same release as the Gatekeeper chart; `test-gatekeeper` runs the constraint template suites offline                                                                                                 |
| TruffleHog                       | 3.99.7                  | 2026-11-08 | `mise run scan-secrets`: git history and tracked files, verified + unknown + unverified results; `.kore/` and SOPS ciphertext excluded via `.trufflehog-exclude`; verification needs network        |
| OSV-Scanner                      | 2.7.0                   | 2026-11-08 | `mise run scan-vulns`: npm lockfiles against the OSV database (network); container images are not scanned (see ADR 0030)                                                                            |
| Semgrep                          | 1.182.1                 | 2026-11-08 | `mise run scan-sast`: committed rules in `infra/policies/semgrep` only, no registry, no metrics; rule tests via `scan-sast-test`                                                                    |
| actionlint                       | 1.7.12                  | 2026-11-08 | `mise run scan-workflows`: workflow syntax and expression checks, offline                                                                                                                           |
| zizmor                           | 1.31.1                  | 2026-11-08 | `mise run scan-workflows`: workflow security audit (`--offline`, regular persona), SHA pinning and permissions                                                                                      |
| hadolint                         | 2.15.1                  | 2026-11-08 | `mise run scan-dockerfiles`: Dockerfile lint for `apps/reference`                                                                                                                                   |
| OPA Envoy image                  | 1.22.2-envoy            | 2026-11-07 | `opa-authorizer` renders; same OPA release as the toolchain CLI; policies pass `test-opa`                                                                                                           |
| Reference base image             | node:26.13.0-alpine3.24 | 2026-11-07 | Latest Node LTS on Alpine                                                                                                                                                                           |

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
