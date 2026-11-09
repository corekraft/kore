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
  forceConflicts: boolean;
  /** Why Helm must take the fields back; required when forceConflicts is set. */
  reason?: string;
}

export interface Catalog {
  $schema?: string;
  components: Component[];
}

export interface Environment {
  $schema?: string;
  name: string;
  provider: "minikube" | "managed";
  kubeContext: string;
  cluster: {
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
  /** The one registry address (host[:port]) every consumer derives from. */
  registry: { address: string };
  /**
   * Repository prefix (host included) of the signed platform image mirror. When
   * set, every approved platform image is rewritten to `<prefix>/<name>` by the
   * environment's values overlays and admitted by the image policy (ADR 0044).
   */
  platformMirror?: string;
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

export interface Repository {
  root: string;
  versions: Versions;
  seeds: SeedManifest;
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
