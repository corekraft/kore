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
  dependencies: string[];
  timeout: string;
  values?: string[];
  readiness: string[];
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
  };
  gateway: { namespace: string; name: string; hostname: string; port: number };
  secrets: { storeName: string; sourceNamespace: string };
  telemetry: { otlpEndpoint: string };
  componentValues?: Record<string, string[]>;
}

export interface Repository {
  root: string;
  versions: Versions;
  catalog: Catalog;
  environment: Environment;
}
