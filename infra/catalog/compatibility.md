# MVP compatibility matrix

Validated offline on 2026-11-07. Live conformance remains an opt-in integration
test and is required before a release is tagged. **The live bootstrap test has
not been run against these pins and is still required.**

Target Kubernetes minor: 1.37 (the newest minor supported by Minikube 1.39,
whose default is 1.37.0). Offline evidence per row: the chart renders with the
repository values and the CRDs the catalog says the component owns are present.
Kubernetes 1.37 support below is what upstream publishes; it is not yet proven
on a live cluster.

| Component              | Pinned version | Date       | Kubernetes contract                                                                          |
| ---------------------- | -------------- | ---------- | -------------------------------------------------------------------------------------------- |
| Kubernetes             | 1.37.0         | 2026-09-13 | Minikube 1.39 supported release                                                              |
| Helm                   | 4.3.0          | 2026-09-13 | Chart rendering and release client                                                           |
| Gateway API            | 1.7.0          | 2026-11-07 | Standard channel, `gateway.networking.k8s.io/v1`; 1.7 breaking changes are experimental-only |
| cert-manager           | 1.21.3         | 2026-11-07 | Gateway API certificate integration enabled; patch release                                   |
| Gatekeeper             | 3.23.1         | 2026-11-07 | `templates.gatekeeper.sh/v1`; already latest stable chart (3.24.0 is beta only)              |
| Istio                  | 1.31.4         | 2026-11-07 | Ambient profile, Gateway API, Kubernetes 1.37; charts from `blob.istio.io` (see note)        |
| Crossplane             | 2.4.3          | 2026-11-07 | Namespaced v2 composite resources; patch release                                             |
| function-go-templating | v0.13.2        | 2026-11-07 | Composition pipeline function for `infra/apis/postgresql`                                    |
| function-auto-ready    | v0.7.3         | 2026-11-07 | Composition pipeline function for `infra/apis/postgresql`                                    |
| External Secrets       | 2.14.0         | 2026-11-07 | `external-secrets.io/v1`                                                                     |
| CloudNativePG chart    | 0.29.1         | 2026-11-07 | PostgreSQL operator API v1; patch release                                                    |
| OpenTelemetry Operator | 0.122.0        | 2026-09-13 | Collector custom resources and target allocator                                              |

Istio 1.31 stops publishing to `istio-release.storage.googleapis.com`; the
catalog now uses `https://blob.istio.io/istio-release/charts`. Istio 1.31 also
sends unhealthy endpoints by default; this repository sets no outlier
detection, so no values change.

All pins are centralized in `versions.yaml`. A controller upgrade must render
offline, pass CRD ownership tests, and pass the live bootstrap test before the
matrix is changed.
