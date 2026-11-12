export type Phase =
  "bootstrap" | "core" | "observability" | "configuration" | "enforcement";
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
  dependencies: string[];
  timeout: string;
  values?: string[];
  readiness: string[];
  helm?: HelmOptions;
}

/** Per-component Helm behavior that is off unless the catalog opts in. */
export interface HelmOptions {
  /**
   * Upgrade with server-side apply `--force-conflicts`, for a release whose
   * controller co-owns fields of the release's own objects.
   */
  forceConflicts?: boolean;
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
  hostPort: number;
  loadBalancerPort: number;
}

export interface Environment {
  $schema?: string;
  name: string;
  provider: "k3d" | "minikube" | "managed";
  kubeContext: string;
  /**
   * Minikube settings. Minikube-only: a k3d overlay declares `k3d` instead and
   * validation rejects this block there. Read it through `minikubeCluster`.
   */
  cluster?: {
    profile: string;
    kubernetesVersion: string;
    driver: string;
    containerRuntime: string;
    cpus: number;
    memoryMB: number;
    diskSize: string;
    /** Service ClusterIP range handed to Minikube; an in-cluster registry address must lie inside it. */
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
  gateway: { namespace: string; name: string; hostname: string; port: number };
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
}
