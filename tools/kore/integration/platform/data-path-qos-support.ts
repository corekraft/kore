import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { gatewayClassName, type Repository } from "../../src/config/index.js";
import { helmEnv, helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

// Shared by the data-path Guaranteed QoS specs (issue 1593, ADR 0152).

/** The flag that gives the gateway proxy, platform DNS, the policy controller and the registry Guaranteed QoS. */
export const dataPathQosFlag = "data-path-guaranteed-qos";

/** The repository with the Guaranteed QoS flag set as given; the rest as the overlay has them. */
export function withQos(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: { ...repository.environment.features, [dataPathQosFlag]: on },
    },
  };
}

/** The CPU and memory a container asks for, as a render writes them. */
export interface Sizes {
  cpu?: string;
  memory?: string;
}

/** A container's resources; a chart that sets no size renders `requests: null`. */
export interface Resources {
  requests?: Sizes | null;
  limits?: Sizes | null;
}

/** A rendered container and the resources it declares. */
export interface Container {
  name: string;
  resources?: Resources | null;
}

/** A pod template's spec: its containers and its init containers. */
export interface PodSpec {
  containers?: Container[];
  initContainers?: Container[];
  priorityClassName?: string;
}

/** One rendered YAML document, with only the fields these specs read. */
export interface Doc {
  kind?: string;
  metadata?: { name?: string };
  spec?: {
    template?: { spec?: PodSpec };
    resources?: Resources | null;
    deployment?: { spec?: { template?: { spec?: PodSpec } } };
  };
  data?: { deployment?: string };
  value?: number;
  globalDefault?: boolean;
}

/** A container's sizes, as the containers of a pod are compared. */
export interface ContainerSizes {
  name: string;
  requests?: Sizes;
  limits?: Sizes;
}

/** Each YAML document a render holds, parsed by yq; empty documents are dropped. */
export function documents(text: string): Doc[] {
  const json = execFileSync("yq", ["-o=json", "-I=0", "."], {
    input: text,
    encoding: "utf8",
  });
  return json
    .split("\n")
    .filter((line) => line.trim() !== "" && line !== "null")
    .map((line): Doc => JSON.parse(line));
}

/** The rendered document of a kind with the given metadata.name; the render must hold it. */
export function find(docs: Doc[], kind: string, name: string): Doc {
  const found = docs.find(
    (doc) => doc.kind === kind && doc.metadata?.name === name,
  );
  assert.ok(found, `the render holds ${kind}/${name}`);
  return found;
}

/** The containers of a pod spec, init containers included, with their requests and limits. */
export function containersOf(podSpec: PodSpec): ContainerSizes[] {
  return [...(podSpec.initContainers ?? []), ...(podSpec.containers ?? [])].map(
    (container) => ({
      name: container.name,
      // A chart that sets no size renders `requests: null`, which is no request.
      ...(container.resources?.requests
        ? { requests: container.resources.requests }
        : {}),
      ...(container.resources?.limits
        ? { limits: container.resources.limits }
        : {}),
    }),
  );
}

const SIZED = ["cpu", "memory"] as const;

/** Whether a container asks for CPU and memory with a request equal to its limit. */
function isGuaranteed({ requests = {}, limits = {} }: ContainerSizes): boolean {
  return SIZED.every(
    (resource) =>
      requests[resource] !== undefined &&
      requests[resource] === limits[resource],
  );
}

/** Whether every container of a pod is Guaranteed: the class the kernel reads as the one it spares last. */
export function guaranteed(containers: ContainerSizes[]): boolean {
  return containers.length > 0 && containers.every(isGuaranteed);
}

/** The pod spec of a Deployment or Job, found by its metadata.name. */
export function podSpecOf(docs: Doc[], kind: string, name: string): PodSpec {
  const spec = find(docs, kind, name).spec?.template?.spec;
  assert.ok(spec, `${kind}/${name} has a pod template`);
  return spec;
}

/** One container of a pod by its name; the pod must hold it. */
export function containerNamed(
  containers: ContainerSizes[],
  name: string,
): ContainerSizes {
  const found = containers.find((c) => c.name === name);
  assert.ok(found, `the pod holds the ${name} container`);
  return found;
}

/**
 * The sizes the gateway overlay gives the proxy, for either class: the Istio
 * ConfigMap's deployment patch (its istio-proxy container), or the
 * AgentgatewayParameters' spec.resources. Undefined when the overlay sets none.
 */
export function gatewayOverlaySizes(
  repository: Repository,
  output: string,
): ContainerSizes | undefined {
  const docs = documents(output);
  if (gatewayClassName(repository.environment) === "istio") {
    const configMap = docs.find(
      (doc) =>
        doc.kind === "ConfigMap" &&
        doc.metadata?.name === "kore-gateway-service",
    );
    const patch = configMap?.data?.deployment;
    if (patch === undefined) {
      return undefined;
    }
    const patched = documents(patch)[0];
    return containersOf(patched?.spec?.template?.spec ?? {}).find(
      (c) => c.name === "istio-proxy",
    );
  }
  const parameters = docs.find(
    (doc) =>
      doc.kind === "AgentgatewayParameters" &&
      doc.metadata?.name === "kore-gateway-service",
  );
  const resources = parameters?.spec?.resources;
  if (!resources) {
    return undefined;
  }
  return {
    name: "proxy",
    ...(resources.requests ? { requests: resources.requests } : {}),
    ...(resources.limits ? { limits: resources.limits } : {}),
  };
}

/** A platform chart rendered as the platform renders it, with the post-renderer plugin it may need. */
export function renderComponent(repository: Repository, name: string): string {
  const component = repository.catalog.components.find((c) => c.name === name);
  assert.ok(component, `the catalog has the ${name} component`);
  return execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    {
      cwd: repository.root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: helmEnv(repository, component) ?? process.env,
    },
  );
}

/** The overlays a data-path spec covers: every environment the platform ships. */
export const overlays = ["local", "vps", "managed-example"];
