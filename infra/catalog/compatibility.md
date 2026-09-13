# MVP compatibility matrix

Validated offline on 2026-09-13. Live conformance remains an opt-in integration
test and is required before a release is tagged.

| Component | Pinned version | Kubernetes contract |
| --- | --- | --- |
| Kubernetes | 1.35.1 | Minikube 1.38 supported release |
| Helm | 4.2.3 | Chart rendering and release client |
| Gateway API | 1.4.0 | Standard channel, `gateway.networking.k8s.io/v1` |
| cert-manager | 1.21.1 | Gateway API certificate integration enabled |
| Gatekeeper | 3.21.0 | `templates.gatekeeper.sh/v1` |
| Istio | 1.30.4 | Ambient profile, Gateway API, Kubernetes 1.35 |
| Crossplane | 2.3.4 | Namespaced v2 composite resources |
| External Secrets | 1.2.1 | `external-secrets.io/v1` |
| CloudNativePG chart | 0.26.0 | PostgreSQL operator API v1 |
| OpenTelemetry Operator | 0.122.0 | Collector custom resources and target allocator |

All pins are centralized in `versions.yaml`. A controller upgrade must render
offline, pass CRD ownership tests, and pass the live bootstrap test before the
matrix is changed.
