import type { ChartDeliveryValues } from "./chart-delivery.js";
export type Phase =
  "bootstrap" | "core" | "observability" | "configuration" | "enforcement";
/** Who reconciles a release: kore through Helm, or the platform Argo CD (ADR 0043). */
export type Owner = "kore" | "argocd";
export type ComponentKind = "helm" | "local-chart" | "manifest";

export interface Versions {
  $schema?: string;
  tools: Record<string, string>;
  kubernetes: string;
  components: Record<string, string>;
  images: Record<string, string>;
}

export interface Component {
  name: string;
  phase: Phase;
  namespace: string;
  kind: ComponentKind;
  repository?: string;
  chart?: string;
  source?: string;
  version: string;
  ownsCRDs: string[];
  /** API groups whose CRDs this component's controller installs at runtime. */
  ownsCRDGroups?: string[];
  /**
   * Feature flag from the environment overlay's `features:` map. When the
   * flag is off the component is validated and rendered but never installed;
   * status reports it as gated off.
   */
  featureFlag?: string;
  /**
   * The release's desired-state owner; omitted means `kore`. `argocd` takes
   * effect only while `platform-argocd-delivery` is on (ADR 0043).
   */
  owner?: Owner;
  /**
   * Whether the platform labels this component's namespace
   * `istio.io/dataplane-mode: ambient` once the component is enabled. Helm
   * creates the namespace unlabelled; kore owns only the label.
   */
  meshEnrolled?: boolean;
  /**
   * Whether the component attaches a route to the shared Gateway. While
   * `platform-shared-gateway` is on, the platform labels its namespace
   * `platform.kore.dev/shared-gateway: "true"` so the Gateway admits the route
   * (ADR 0134). Helm creates the namespace unlabelled; kore owns only the label.
   */
  sharedGatewayRoutes?: boolean;
  /**
   * With `sharedGatewayRoutes`, the flag under which the route renders at all.
   * The namespace is labelled only while that flag is on as well, so the flag
   * off changes no namespace (ADR 0132).
   */
  sharedGatewayRouteFlag?: string;
  dependencies: string[];
  timeout: string;
  values?: string[];
  readiness: string[];
  helm?: HelmOptions;
  /** Probe fields a chart gives no value for, applied by a Helm post-renderer (see the probe patches ADR). */
  patches?: ProbePatch[];
}

/** A rendered workload container whose probe fields kore sets after Helm renders. */
export interface ProbePatch {
  target: { kind: string; name: string; container: string };
  /** Why the chart cannot be tuned through its own values. */
  reason: string;
  probes: Partial<
    Record<
      "livenessProbe" | "readinessProbe" | "startupProbe",
      Record<string, number>
    >
  >;
}

/** Per-component Helm behavior that is off unless the catalog opts in. */
export interface HelmOptions {
  /**
   * Upgrade with server-side apply `--force-conflicts`, for a release whose
   * controller co-owns fields of the release's own objects.
   */
  forceConflicts?: boolean;
  /**
   * Upgrade with `--take-ownership`, for a release that adopts objects an
   * earlier kubectl apply created (the manifest-to-chart conversion, ADR 0137),
   * so Helm does not refuse them for missing ownership metadata.
   */
  takeOwnership?: boolean;
  /**
   * `false` makes Helm wait for hooks only, not for the release's resources, for
   * a resources-only release whose claim binds when its consumer starts. The
   * consumer's own readiness check proves the volume.
   */
  wait?: false;
  /** Why; required when forceConflicts is set or wait is false. */
  reason?: string;
}

export interface Catalog {
  $schema?: string;
  components: Component[];
}

/**
 * A k3d cluster. The k3s image is not a field: it resolves from the
 * `versions.images.k3s` pin, so one pin owns it.
 */
export interface K3dCluster {
  /** Cluster name; the kube context must be `k3d-<clusterName>`. */
  clusterName: string;
  /** Service ClusterIP range; an in-cluster registry address must lie inside it. */
  serviceCidr: string;
  /** Host ports published through the k3d load balancer. */
  ports: K3dPort[];
  /** Server nodes; one when unset. */
  servers?: number;
  /** Agent nodes; none when unset. */
  agents?: number;
}

export interface K3dPort {
  /** The loopback IPv4 address the host port binds (ADR 0131). */
  hostAddress: string;
  hostPort: number;
  loadBalancerPort: number;
  /**
   * Skipped by the check that refuses `kore local up` when a host port is
   * taken (#1198). The overlay still publishes the port.
   */
  optional?: boolean;
  /** The transport the mapping publishes; TCP when unset. */
  protocol?: "tcp" | "udp";
  /**
   * The feature flag that makes this mapping real. While the flag is off the
   * mapping is not created, not compared by the drift check and not probed, so
   * a cluster created without it stays valid. Unset means always published.
   */
  featureFlag?: string;
  /**
   * True when this environment opts out of the mapping (a developer's native
   * Postgres holds the host port): it is not created, compared or probed, and
   * the rest of the platform comes up. Unset means opted in.
   */
  optOut?: boolean;
}

export interface Environment {
  $schema?: string;
  name: string;
  provider: "k3d" | "managed";
  kubeContext: string;
  /**
   * Cluster settings of a managed environment. A k3d overlay declares `k3d`
   * instead and validation rejects this block there. Read it through
   * `managedCluster`.
   */
  cluster?: {
    profile: string;
    kubernetesVersion: string;
    driver: string;
    containerRuntime: string;
    cpus: number;
    memoryMB: number;
    diskSize: string;
    /** Service ClusterIP range of the cluster; an in-cluster registry address must lie inside it. */
    serviceCidr?: string;
  };
  /** The k3d cluster; required when provider is k3d, rejected otherwise. */
  k3d?: K3dCluster;
  /** The one registry address (host[:port]) every consumer derives from. */
  registry: { address: string };
  /**
   * Repository prefix (host included) of the signed platform image mirror. When
   * set, every approved platform image is rewritten to `<prefix>/<name>` by the
   * environment's values overlays and admitted by the image policy (ADR 0044).
   */
  platformMirror?: string;
  /**
   * How the running-image inventory treats an image that is not an approved
   * internal digest (ADR 0056). `audit` (the default) reports; `enforce` fails
   * bootstrap and keeps the application admission gate closed.
   */
  imageInventory?: "audit" | "enforce";
  /**
   * Mode of the policy-exemption check, `audit` or `enforce`; unset reads as
   * `audit`. Accepted and validated now; the exemption check that consumes it
   * is a later ticket under #613.
   */
  exemptionCheck?: "audit" | "enforce";
  /**
   * Platform namespaces exempt from the Policy Controller enrollment check,
   * each with its reason (ADR 0056). Their images are still inventoried.
   * Validation rejects a namespace the catalog does not manage.
   */
  enrollmentExemptions?: Record<string, string>;
  /**
   * API groups whose CRDs the environment's provider ships (k3s installs
   * `k3s.cattle.io` and `helm.cattle.io`), each with its reason (ADR 0088).
   * The CRD ownership status counts them as owned by the provider, not Kore.
   * Validation rejects a group a catalog component also owns.
   */
  providerOwnedCRDGroups?: Record<string, string>;
  /**
   * Feature flags: flag name to boolean, off unless set true (ADR 0077). Read
   * by the CLI and passed into local chart values as `features.<name>`.
   */
  features?: Record<string, boolean>;
  /**
   * Where the platform's default alerts email (plan 15 step 6). Unset until the
   * owner names an address; then the alerts have no contact point. SMTP
   * credentials never live here (ADR 0034): `kore secrets smtp` streams them.
   */
  alertEmail?: {
    addresses?: string[];
    smtp?: { host?: string; port?: number; from?: string };
  };
  /**
   * The platform's one name field: the platform domain and the platform
   * organization's identifier. Every chart's copy of the domain, the Gateway's
   * hostname and the delivery path's value derive from it (ADR 0042).
   */
  platform: { domain: string; organizationId: string };
  gateway: { namespace: string; name: string; port: number };
  secrets: { storeName: string; sourceNamespace: string };
  telemetry: { otlpEndpoint: string };
  componentValues?: Record<string, string[]>;
  /**
   * A manifest component's own source directory in this environment, used in
   * place of the catalog `source` (ADR 0044): Function packages are not Helm
   * values, so a managed environment keeps its own copy with mirror references.
   */
  componentSources?: Record<string, string>;
}

/**
 * Machine-readable upstream provenance: the exact keyless signer the release
 * workflow verifies before mirroring, or an explicit statement that upstream
 * publishes no signature.
 */
export type SeedProvenance =
  { signed: true; issuer: string; identity: string } | { signed: false };

export interface SeedEvidence {
  method: string;
  source: string;
  checked: string;
  provenance: SeedProvenance;
}

export interface Seed {
  image: string;
  catalogImage: string;
  component: string;
  reason: string;
  evidence: SeedEvidence;
}

export interface SeedManifest {
  $schema?: string;
  seeds: Seed[];
}

/**
 * A platform image the release mirror may copy: approved, but not a seed, so
 * it is deployed only after the verifier runs. `name` is its mirror path.
 */
export interface ApprovedImage {
  image: string;
  name: string;
  component: string;
  evidence: SeedEvidence;
}

export interface ApprovedImageManifest {
  $schema?: string;
  images: ApprovedImage[];
}

export type ReadinessCapability =
  | "controller"
  | "registry"
  | "trust-policy"
  | "shared-configuration"
  | "platform-api"
  | "endpoint"
  | "health-condition";

/** One prerequisite the application admission gate waits for (ADR 0067). */
export interface ReadinessRequirement {
  name: string;
  /** The plan step (7 to 11) whose contract this prerequisite serves. */
  step: number;
  capability: ReadinessCapability;
  /** Catalog components that must be installed and ready. */
  components?: string[];
  /** Platform-wide status checks (not components) that must be ready. */
  platformChecks?: string[];
}

export interface ReadinessManifest {
  $schema?: string;
  version: 1;
  requirements: ReadinessRequirement[];
}

/** The kore-golden-path-delivery chart's values (infra/charts/golden-path-delivery). */
export interface GoldenPathDeliveryValues {
  repoURL: string;
  revision: string;
  environment: string;
  templateImages: Record<string, { image: string; digest: string }>;
  ingress: { platformDomain: string; gatewayClassName: string };
  /** True while platform-shared-gateway is on: the sync labels the app namespaces it creates (ADR 0133). */
  sharedGateway?: boolean;
}

export interface Repository {
  root: string;
  versions: Versions;
  seeds: SeedManifest;
  readiness: ReadinessManifest;
  approved: ApprovedImageManifest;
  catalog: Catalog;
  environment: Environment;
  /** Parsed environment overlay of the kore-image-policy component. */
  imageTrustValues?: Record<string, unknown> | undefined;
  /**
   * Parsed environment overlays of the components that receive the registry
   * address as a platform value; validation rejects hardcoded registry values.
   */
  registryComponentValues?: Record<string, Record<string, unknown>> | undefined;
  /**
   * The kore-config-delivery chart's values, composed from the chart lock and
   * the catalog by `platform up` before it touches the cluster (ADR 0043).
   */
  chartDelivery?: ChartDeliveryValues | undefined;
  /**
   * The kore-golden-path-delivery chart's values, composed from the template
   * lock, the checked-out commit and the environment by `platform up` before it
   * touches the cluster (ADR 0043).
   */
  goldenPathDelivery?: GoldenPathDeliveryValues | undefined;
  /**
   * The Service names the registrations in git declare, sorted; set by
   * `loadRepository` whatever the flags are. Every consumer reads the registered
   * Services from here (plan 15, #1235).
   */
  registeredServices?: readonly string[] | undefined;
  /** Findings that warn without failing validation; set by `loadRepository`. */
  warnings?: string[] | undefined;
}
