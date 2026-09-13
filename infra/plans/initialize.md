# Local Kubernetes Platform Initialization Plan

## Goal

Create a provider-neutral Kubernetes platform that is pleasant to use locally
with Minikube and can later move to managed Kubernetes providers with minimal
application changes.

The platform hosts frontend, backend, internal developer platform, identity and
access management, and other application workloads. It provides the foundational
services those workloads require and establishes OpenTelemetry as the standard
interface for logs, metrics, and traces.

## Definitions

- **Infrastructure** is any foundational capability required for applications to
  run, including clusters, ingress, certificates, telemetry, secrets, persistence,
  databases, queues, service identity, policy enforcement, and the controllers
  that provide those capabilities.
- **Application** is a business-facing or developer-facing workload running in
  Kubernetes and consuming infrastructure capabilities.
- **Infrastructure claim** describes an application's need for a capability. The
  claim belongs to the application's requirements, while its implementation and
  operation belong to infrastructure.
- **Tool** is an open-source tool configuration or a custom CLI used to perform a
  focused, automated operation.

## Responsibility Boundaries

### OpenTofu

OpenTofu provisions infrastructure that exists outside of or must exist before
Kubernetes. This includes cloud accounts and projects, networks, managed clusters,
node pools, foundational identity and access management, key management, external
secret stores, registries, DNS zones, and state storage.

OpenTofu does not manage application releases or ordinary in-cluster Kubernetes
resources. This keeps infrastructure state independent from Helm release state and
from the continuous reconciliation performed by Kubernetes controllers.

### Helm

Helm installs and upgrades software and resources inside Kubernetes. Helm charts
contain reusable application packaging and provider-neutral Kubernetes resources.
Application charts must not contain Minikube-specific or cloud-provider-specific
logic.

Controllers and Custom Resource Definitions (CRDs) belong to dedicated
infrastructure charts. Their lifecycle is managed separately from application
charts because they are cluster-wide platform APIs.

### Kubernetes Controllers

Applications request infrastructure through stable Kubernetes custom resources
installed by their Helm charts. Infrastructure controllers reconcile those claims
into environment-specific implementations.

For example, the same database claim may create a PostgreSQL workload in the local
cluster or a managed database in a cloud environment. Both implementations must
expose the same application-facing connection contract, normally through a
Kubernetes Secret.

### Local and Provider-Specific Tooling

Minikube-specific behavior remains in local scripts and environment configuration.
Provider-specific behavior is isolated in infrastructure modules, variables, and
environment overlays.

## Principles

- Kubernetes is the runtime and application-facing control plane.
- OpenTofu provisions the infrastructure substrate.
- Helm installs and upgrades in-cluster software.
- Applications request infrastructure through stable Kubernetes custom resources.
- Infrastructure implementations may vary by environment, but their
  application-facing contracts remain stable.
- Local implementations prefer Kubernetes workloads, while other environments may
  substitute managed services without requiring application code changes.
- OpenTelemetry is the standard application interface for logs, metrics, and traces.
- Kubernetes ServiceAccounts and Istio identities are the standard workload
  identity boundary.
- OPA validates workload identity configuration at admission time and provides
  contextual authorization decisions at runtime where native Istio policy is not
  sufficient.
- Secrets and persistent services have explicit ownership, lifecycle, and retention
  boundaries rather than hidden defaults.
- Local development has a small number of predictable commands.
- Every required operation is automated and repeatable. Each tool has one clear
  responsibility, performs it well, and composes through stable interfaces.
- Open-source tools and open standards are preferred. Exceptions are recorded as
  architectural decisions.
- No workflow requires undocumented, ad hoc cluster patching.

## Repository Boundaries

This is a monorepo with the following top-level ownership:

- `/infra` contains cluster definitions, platform services, infrastructure APIs,
  environment configuration, and infrastructure lifecycle automation.
- `/apps` contains application source code, application charts, and
  application-owned infrastructure claims.
- `/tools` contains shared tool configuration and custom developer tooling.

## Initialization Lifecycle

The platform is initialized before applications are installed. Cloud networking,
identity, and other substrate dependencies may need to exist before the cluster,
so their exact provisioning order is determined by the selected environment and
the OpenTofu dependency graph.

1. Validate the environment and required tools.
2. Provision the environment substrate.
3. Create or connect to the Kubernetes cluster.
4. Select and verify the intended Kubernetes context.
5. Install infrastructure APIs and controllers.
6. Install foundational services.
7. Wait for every required infrastructure capability to become ready.
8. Report platform readiness and endpoints.

For Minikube, provisioning the environment substrate means preparing the local
environment before creating the cluster. For a cloud environment, it may include
networking, identity, and other dependencies required by a managed cluster.

Platform initialization does not install applications.

### Infrastructure Installation Phases

Infrastructure is installed in dependency-aware phases:

1. **Bootstrap** installs namespaces, CRDs, infrastructure controllers, and their
   policy or admission prerequisites. OPA Gatekeeper constraints begin in audit
   mode so that bootstrap cannot block its own dependencies.
2. **Core capabilities** install workload identity, the service mesh, ingress,
   certificates, secret delivery, storage, database or messaging operators, and
   the OPA runtime authorizer.
3. **Observability** installs the OpenTelemetry collection path and the required
   metrics, logs, and traces services.
4. **Policy enforcement** promotes validated Gatekeeper constraints and runtime
   authorization policies from audit to enforcement after all dependencies are
   ready.

The specific components used to implement these capabilities are selected
separately from this lifecycle contract.

## Application Lifecycle

Applications are installed only after the platform is ready:

1. Verify platform readiness.
2. Install or upgrade the application's infrastructure claims.
3. Wait for every claim to report that it is ready.
4. Verify that required Secrets and endpoints exist.
5. Install or upgrade the application workload.
6. Wait for the workload rollout to complete.
7. Report application readiness and endpoints.

Infrastructure claims and application workloads use separate Helm releases. For
an application named `example`, those releases are:

- `example-resources` for infrastructure claims.
- `example` for Deployments, Services, ConfigMaps, and other workload resources.

This lifecycle boundary allows workloads to be replaced or removed without
implicitly deleting their persistent infrastructure.

Stateful infrastructure claims must define an explicit retention policy. Removing
an application or stopping a local platform retains persistent resources by
default. Permanent data deletion requires a separate, explicit purge operation.

## Command Contract

`kore` is the stable developer-facing command namespace. Its initial command
surface is:

| Command | Responsibility |
| --- | --- |
| `kore doctor` | Validate required tools, versions, credentials, and host capacity. |
| `kore platform up --environment <name>` | Reconcile the cluster and all foundational infrastructure. |
| `kore platform status --environment <name>` | Report platform readiness without making changes. |
| `kore app up <name> --environment <name>` | Reconcile one application's claims and workload. |
| `kore app status <name> --environment <name>` | Report application and claim readiness without making changes. |
| `kore app down <name> --environment <name>` | Remove an application workload while retaining stateful resources. |
| `kore platform stop --environment <name>` | Stop a local platform while retaining its cluster profile and data. |
| `kore platform destroy --environment <name>` | Destroy a platform after explicit confirmation. |

The `--environment` argument is required for every mutating command. Commands must
not silently use the current `kubectl` context.

The `kore` command composes focused tools without taking over their concerns:

- Minikube creates and removes the local cluster.
- OpenTofu provisions external infrastructure.
- Helm installs and upgrades in-cluster resources.
- `kubectl` observes resources and waits for readiness.

### Command Behavior

Every mutating command must:

- Resolve and verify its intended Kubernetes context before changing resources.
- Be idempotent and safe to run repeatedly.
- Resume safely after a partial failure.
- Use pinned tool, chart, and provider versions.
- Wait for readiness with a bounded timeout.
- Return a nonzero exit code when convergence fails.
- Identify the failed component without requiring undocumented manual patching.
- Support non-interactive execution in CI.

Destructive commands must:

- Require confirmation during interactive use.
- Require an explicit confirmation flag during non-interactive use.
- Retain persistent resources by default.
- Require an explicit `--purge-data` operation to delete persistent data.
- Refuse to destroy a local cluster containing retained data unless that data is
  explicitly purged or a verified export exists.

## Lifecycle Acceptance Criteria

- A new local platform can be created with one developer-facing command.
- Platform creation does not install applications.
- One application can be installed with one developer-facing command.
- Repeating platform or application reconciliation produces no unintended changes.
- An interrupted operation can be rerun safely.
- A command refuses to operate against an unexpected cluster.
- Application installation stops when an infrastructure claim is not ready.
- Application removal and local platform stop retain stateful data by default.
- Local platform destruction is blocked while retained data exists unless an
  explicit purge or verified export permits it.
- Status commands are read-only.

## Minimum Viable Platform Capabilities

The first platform increment is a thin vertical slice driven by one reference
application. Capabilities are defined by their application-facing contracts before
specific implementations are selected.

| Capability | Application-facing contract | Local behavior | Portability requirement |
| --- | --- | --- | --- |
| Networking | Kubernetes `Gateway` and `HTTPRoute` resources | Route traffic through an Istio-managed gateway | Replace the gateway or load balancer without changing application manifests |
| Certificates | A TLS endpoint and trusted certificate contract | Issue certificates from a local issuer | Substitute a public or provider-managed issuer |
| Secrets | A Kubernetes Secret reference | Materialize secrets from a local source | Substitute an external secret manager without changing the workload |
| Database | A database claim and connection Secret | Run PostgreSQL as a Kubernetes workload | Substitute managed PostgreSQL while preserving the claim and Secret schema |
| Persistence | A PersistentVolumeClaim and storage class contract | Provision storage backed by the local environment | Substitute a cloud storage class while preserving claim semantics |
| Observability | An OTLP endpoint and standard telemetry attributes | Collect logs, metrics, and traces locally | Substitute telemetry backends without changing application instrumentation |
| Workload identity | A dedicated Kubernetes ServiceAccount represented as an Istio SPIFFE principal | Issue short-lived mesh identities and enforce mutual TLS | Preserve the principal contract across Kubernetes environments |
| Policy | Gatekeeper constraints and Istio authorization policy | Audit configuration and enforce admission and runtime decisions | Keep policy inputs stable and policy bundles versioned |
| Container images | An OCI image reference | Build or load the image into Minikube | Push the same image format to a provider registry |

### Reference Application

The first reference application validates the platform through all capability
layers. It requires:

- An HTTP endpoint with TLS.
- A PostgreSQL database.
- A persistent resource with an explicit retention policy.
- Secret injection through a Kubernetes Secret reference.
- OpenTelemetry logs, metrics, and traces.
- A dedicated Kubernetes ServiceAccount and Istio workload identity.
- Mutual TLS for service-to-service traffic.
- Native Istio authorization and one OPA-backed contextual authorization decision.
- OPA Gatekeeper admission and audit validation.
- Kubernetes health and readiness reporting.

### Capability Requirements

Each capability must define:

- Its stable application-facing API and version.
- Its owning infrastructure component.
- Its readiness conditions and bounded wait behavior.
- Its local implementation and permitted environment substitutions.
- Its Secret, endpoint, and status output schemas where applicable.
- Its upgrade, removal, retention, and recovery behavior.

The reference application is complete only when it can move between local and
managed implementations by changing environment configuration rather than
application code or provider-specific application templates.

## Initial Tool Selection

Every selected tool must be version-pinned and tested against the selected
Kubernetes version. Applications depend on the stable contracts described above,
not on implementation-specific APIs unless a reviewed exception is recorded.

| Concern | Selected tool or standard | Responsibility |
| --- | --- | --- |
| Local Kubernetes | Minikube with containerd | Create, stop, and inspect the local cluster profile. |
| External infrastructure | OpenTofu | Provision resources outside of or required before Kubernetes. |
| Kubernetes packaging | Helm | Install and upgrade infrastructure and application releases. |
| Platform APIs | Crossplane v2 | Define namespaced application-facing APIs and environment-specific compositions. |
| Edge and mesh API | Kubernetes Gateway API | Provide portable `Gateway` and route resources. |
| Gateway and service mesh | Istio in ambient mode | Implement Gateway API, workload identity, mutual TLS, runtime authorization, and mesh telemetry. |
| Admission policy | OPA Gatekeeper | Validate resources during admission and continuously audit existing resources. |
| Runtime policy decisions | OPA with the OPA-Envoy plugin | Evaluate contextual Layer 7 authorization requests delegated by Istio. |
| Certificates | cert-manager | Issue, renew, and materialize certificates from environment-selected issuers. |
| Local certificate trust | mkcert-backed local CA | Establish host-trusted local development certificates. |
| Secret synchronization | External Secrets Operator | Materialize external values into Kubernetes Secrets. |
| Local secrets at rest | SOPS with age | Store encrypted development secrets in version control. |
| Local PostgreSQL | CloudNativePG | Operate PostgreSQL as a Kubernetes workload. |
| Persistent storage | Kubernetes StorageClasses and PersistentVolumeClaims | Express provider-neutral storage and retention requirements. |
| Telemetry collection | OpenTelemetry Collector | Receive OTLP, enrich telemetry, and export it to selected backends. |
| Metrics | Prometheus | Store and query platform and application metrics. |
| Logs | Loki | Store and query OpenTelemetry logs. |
| Traces | Tempo | Store and query OpenTelemetry traces. |
| Observability UI | Grafana | Query and correlate metrics, logs, and traces. |
| Tool versions | mise | Install and pin repository development tool versions. |
| Kubernetes inspection | `kubectl` | Observe resources and wait for readiness without owning desired state. |
| Local image delivery | Minikube image tooling | Build or load OCI images into the local cluster runtime. |

Envoy Gateway is not part of the initial stack. Istio is the Gateway API
implementation so that the platform has one control plane for ingress, ambient
mesh networking, workload identity, runtime authorization, and mesh telemetry.
Application charts use standard Gateway API resources for ingress. Istio-specific
networking resources remain infrastructure-owned and are used only when the
standard API cannot express a required capability.

### Platform API and PostgreSQL

Crossplane defines a namespaced `PostgreSQLInstance.platform.kore.dev` API rather
than a generic database API. A local composition creates a CloudNativePG cluster;
a provider composition may create managed PostgreSQL. Both compositions publish
the same connection Secret schema and readiness contract.

The initial API exposes only portable requirements such as service class, storage
size, connection Secret name, PostgreSQL compatibility version, and retention
policy. Provider-specific settings remain in environment compositions.

### Workload Identity and Authorization

Every application workload uses a dedicated Kubernetes ServiceAccount. Istio uses
that ServiceAccount to establish a short-lived, mutually authenticated workload
identity with this principal format:

```text
spiffe://<trust-domain>/ns/<namespace>/sa/<service-account>
```

Responsibility is divided as follows:

- Kubernetes ServiceAccounts establish the workload identity input.
- Istio issues and validates the cryptographic identity, provides mutual TLS, and
  enforces native `AuthorizationPolicy` rules.
- OPA Gatekeeper rejects or audits workload definitions that violate identity and
  authorization requirements.
- The OPA-Envoy plugin acts as an external policy decision point for contextual
  Layer 7 decisions delegated through Istio `AuthorizationPolicy` resources with
  the `CUSTOM` action.

Native Istio `ALLOW` and `DENY` policies handle common service-to-service rules.
OPA is used when a decision needs richer context or shared Rego policy. Protected
routes fail closed if the OPA authorizer is unavailable. The initial deployment
uses a platform-operated OPA authorization service rather than injecting OPA
sidecars, preserving the ambient data-plane model. OPA policies are delivered as
versioned bundles and tested independently of application releases.

Initial Gatekeeper identity constraints require:

- A dedicated ServiceAccount rather than the namespace default.
- Explicit service account token mounting behavior.
- No wildcard RBAC permissions or unauthorized role bindings.
- Explicit enrollment in the ambient mesh for participating application namespaces.
- Required ownership, application, and workload identity labels.
- Resource requests, limits, and health probes.
- No privileged containers or unapproved host namespace access.
- No plaintext Secret resources in application releases.
- Explicit retention policy for stateful infrastructure claims.

Constraints start in audit mode. Each constraint moves to enforcement only after
the platform and reference application comply and its failure behavior is tested.
System namespace exemptions must be explicit, minimal, and documented.

### Networking and Certificates

Istio implements Kubernetes Gateway API for ingress and ambient mesh traffic.
Minikube-specific tunnel management remains behind the `kore` command. Application
charts do not invoke Minikube or depend on an Istio `GatewayClass` name directly;
environment configuration supplies infrastructure-owned parent references.

cert-manager provides the `Certificate` contract in every environment. Local
development uses a CA established with mkcert. Managed environments substitute an
ACME or provider-supported issuer without changing application workloads.

### Secrets

Application resource charts create `ExternalSecret` resources that reference a
consistently named platform `SecretStore` or `ClusterSecretStore`.

Locally, SOPS and age decrypt version-controlled values into a protected source
namespace, and External Secrets Operator materializes application-scoped Secrets.
Managed environments replace the store implementation with a provider secret
manager. Plaintext secret values are never committed to the repository or passed
through Helm values.

### Storage and Retention

The platform initially exposes two storage profiles:

- `kore-standard` for disposable data using the environment's standard storage.
- `kore-retained` for persistent data using a `Retain` reclaim policy.

Minikube provides the initial local storage implementation. Stopping its profile
preserves local data. Destroying a profile containing retained data requires an
explicit purge or a verified export. Retention is not a backup; backup and restore
requirements are defined before the platform is considered production-ready.

### Observability

Applications send OTLP logs, metrics, and traces only to the OpenTelemetry
Collector. The Collector enriches signals with Kubernetes and workload identity
attributes and exports them to Prometheus, Loki, and Tempo. Grafana provides the
initial correlated query interface.

Istio telemetry also flows through the platform's OpenTelemetry path where the
supported signal permits it. Applications do not send telemetry directly to a
backend, which allows managed backends to replace the local stack without changing
application instrumentation.

## Deferred Tooling

The following components remain outside the first vertical slice:

- OpenBao or another locally operated external secret server.
- Messaging operators and managed queue compositions.
- GitOps reconciliation.
- Progressive delivery controllers.
- Multi-cluster service mesh and management.
- Production high-availability topology.
- Cloud-specific Crossplane providers and compositions.
- A dedicated Envoy Gateway control plane. It is reconsidered if edge ownership,
  release isolation, or advanced API-gateway requirements justify operating both
  Envoy Gateway and Istio.
