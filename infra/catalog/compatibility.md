# MVP compatibility matrix

Validated offline on 2026-09-13. Live conformance remains an opt-in integration
test and is required before a release is tagged.

| Component              | Pinned version | Kubernetes contract                              |
| ---------------------- | -------------- | ------------------------------------------------ |
| Kubernetes             | 1.37.0         | Minikube 1.39 supported release                  |
| Helm                   | 4.3.0          | Chart rendering and release client               |
| Gateway API            | 1.6.2          | Standard channel, `gateway.networking.k8s.io/v1` |
| cert-manager           | 1.21.2         | Gateway API certificate integration enabled      |
| Gatekeeper             | 3.23.1         | `templates.gatekeeper.sh/v1`                     |
| Istio                  | 1.31.0         | Ambient profile, Gateway API, Kubernetes 1.37    |
| Crossplane             | 2.4.0          | Namespaced v2 composite resources                |
| External Secrets       | 2.10.0         | `external-secrets.io/v1`                         |
| CloudNativePG chart    | 1.30.0         | PostgreSQL operator API v1                       |
| OpenTelemetry Operator | 0.122.0        | Collector custom resources and target allocator  |

All pins are centralized in `versions.yaml`. A controller upgrade must render
offline, pass CRD ownership tests, and pass the live bootstrap test before the
matrix is changed.
