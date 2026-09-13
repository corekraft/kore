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
  databases, queues, and the controllers that provide those capabilities.
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

The platform is initialized before applications are installed:

1. Create or connect to the Kubernetes cluster.
2. Provision infrastructure that exists outside Kubernetes.
3. Install infrastructure controllers, CRDs, and foundational services.
4. Wait for the infrastructure capabilities to become ready.
5. Install application infrastructure claims.
6. Install application workloads.

Stateful infrastructure claims must define an explicit retention policy so that
removing an application release cannot unintentionally destroy persistent data.
