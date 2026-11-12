import type { Environment, K3dCluster, Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { ClusterUnavailableError } from "./cluster-unavailable.js";
import { type ReadinessOptions, waitForClusterReady } from "./readiness.js";

/** The state of a k3d cluster as `k3d cluster list` reports it. */
export type K3dState = "absent" | "stopped" | "running";

export interface K3dClusterInfo {
  state: K3dState;
  /**
   * The cluster's entry from `k3d cluster list`; absent when there is none.
   * Internal: it carries the k3s join token, so it is never reported.
   */
  entry?: Record<string, unknown>;
}

const reportedFields = [
  "serversCount",
  "serversRunning",
  "agentsCount",
  "agentsRunning",
  "hasLoadBalancer",
] as const;

const missingK3d =
  "k3d is not available; install k3d (mise install) and check that Docker is running";

/** The k3d settings of an environment; fails with the cause when it has none. */
export function k3dCluster(environment: Environment): K3dCluster {
  if (environment.k3d === undefined) {
    throw new Error(
      `environment ${environment.name} has no k3d cluster settings; it is a ${environment.provider} overlay, so k3d commands do not apply to it`,
    );
  }
  return environment.k3d;
}

/** Bounds create and start, so a stuck server fails named (create rolls back). */
const k3dWaitArgs = ["--wait", "--timeout", "300s"];

/** The kube context k3d writes for a cluster name. */
export function k3dContext(clusterName: string): string {
  return `k3d-${clusterName}`;
}

/**
 * The `k3d cluster create` arguments: the pinned image, Traefik and ServiceLB
 * disabled (Kore owns the gateway), the overlay service CIDR, the load
 * balancer port mappings, and kubeconfig flags that add the cluster's context
 * without switching the person's current one.
 */
export function k3dCreateArgs(repository: Repository): string[] {
  const cluster = k3dCluster(repository.environment);
  const image = repository.versions.images?.["k3s"];
  if (image === undefined) {
    throw new Error(
      "versions.images.k3s is not pinned; add the digest-pinned k3s image to infra/catalog/versions.yaml",
    );
  }
  return [
    "cluster",
    "create",
    cluster.clusterName,
    "--image",
    image,
    "--servers",
    String(cluster.servers ?? 1),
    "--agents",
    String(cluster.agents ?? 0),
    "--k3s-arg",
    "--disable=traefik@server:*",
    "--k3s-arg",
    "--disable=servicelb@server:*",
    "--k3s-arg",
    `--service-cidr=${cluster.serviceCidr}@server:*`,
    ...cluster.ports.flatMap((port) => [
      "--port",
      `${port.hostPort}:${port.loadBalancerPort}@loadbalancer`,
    ]),
    "--kubeconfig-update-default=true",
    "--kubeconfig-switch-context=false",
    ...k3dWaitArgs,
  ];
}

export function k3dStartArgs(clusterName: string): string[] {
  return ["cluster", "start", clusterName, ...k3dWaitArgs];
}

/** Looks the configured cluster up in `k3d cluster list`; read-only. */
export async function k3dClusterInfo(
  environment: Environment,
  runner: Runner,
): Promise<K3dClusterInfo> {
  const { clusterName } = k3dCluster(environment);
  const args = ["cluster", "list", "--output", "json"];
  const { stdout } = await runK3d(runner, args, { capture: true });
  let entries: unknown;
  try {
    entries = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `k3d ${args.join(" ")} printed unreadable output, not JSON: ${stdout.slice(0, 80)}`,
      { cause: error },
    );
  }
  if (!Array.isArray(entries)) {
    throw new Error(
      `k3d ${args.join(" ")} printed unreadable output: expected a JSON list`,
    );
  }
  const entry = (entries as Record<string, unknown>[]).find(
    (candidate) => candidate["name"] === clusterName,
  );
  if (entry === undefined) {
    return { state: "absent" };
  }
  const count = (field: string): number => Number(entry[field] ?? 0);
  const running =
    count("serversRunning") > 0 &&
    count("serversRunning") >= count("serversCount") &&
    count("agentsRunning") >= count("agentsCount");
  return { state: running ? "running" : "stopped", entry };
}

/** Runs k3d; a binary that cannot be spawned is the install remedy. */
async function runK3d(
  runner: Runner,
  args: readonly string[],
  options: Parameters<Runner["run"]>[2],
): ReturnType<Runner["run"]> {
  try {
    return await runner.run("k3d", args, options);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ClusterUnavailableError(missingK3d, { cause: error });
    }
    throw error;
  }
}

/** Host ports the load balancer publishes, by container port; undefined when not reported. */
function publishedPorts(
  entry: Record<string, unknown>,
): Map<string, string[]> | undefined {
  const nodes = (entry["nodes"] ?? []) as Record<string, unknown>[];
  const mappings = nodes.find((node) => node["role"] === "loadbalancer")?.[
    "portMappings"
  ] as Record<string, { HostPort?: string }[] | null> | undefined;
  if (mappings === undefined) {
    return undefined;
  }
  return new Map(
    Object.entries(mappings).map(([container, bindings]) => [
      container.replace(/\/\w+$/, ""),
      (bindings ?? []).map((binding) => String(binding.HostPort)),
    ]),
  );
}

/**
 * How an existing cluster differs from the overlay. Counts always compare;
 * each declared port must be published on its host port when k3d's entry
 * reports mappings. Extra mappings (k3d publishes the API port on a random
 * host port) are ignored. The service CIDR is not compared: k3d's list does
 * not report it in a form confirmed live (gap for the live proof, #149).
 */
function drift(entry: Record<string, unknown>, cluster: K3dCluster): string[] {
  const differences: string[] = [];
  const compare = (name: string, actual: unknown, wanted: unknown): void => {
    if (String(actual) !== String(wanted)) {
      differences.push(`${name}: ${String(actual)} != ${String(wanted)}`);
    }
  };
  compare("servers", entry["serversCount"], cluster.servers ?? 1);
  compare("agents", entry["agentsCount"], cluster.agents ?? 0);
  const published = publishedPorts(entry);
  if (published !== undefined) {
    for (const port of cluster.ports) {
      const hosts = published.get(String(port.loadBalancerPort)) ?? [];
      if (!hosts.includes(String(port.hostPort))) {
        compare(
          `port ${port.loadBalancerPort}`,
          hosts.length ? hosts.join(",") : "unmapped",
          port.hostPort,
        );
      }
    }
  }
  return differences;
}

function contextRemedy(clusterName: string): string {
  return `set environment.kubeContext to ${k3dContext(clusterName)}; check \`kubectl config get-contexts\` for the contexts this machine has`;
}

function unavailable(clusterName: string, state: K3dState): Error {
  return new ClusterUnavailableError(
    `k3d cluster ${clusterName} is ${state}; run \`kore local up\` to create or start it`,
  );
}

async function listOrUnavailable(
  environment: Environment,
  runner: Runner,
): Promise<K3dClusterInfo> {
  try {
    return await k3dClusterInfo(environment, runner);
  } catch (error) {
    if (error instanceof ClusterUnavailableError) {
      throw error;
    }
    if (!(error instanceof CommandError)) {
      throw error;
    }
    throw new ClusterUnavailableError(
      `k3d cluster ${k3dCluster(environment).clusterName} is unavailable because \`k3d cluster list\` failed; ${missingK3d}`,
      { cause: error },
    );
  }
}

export async function assertExpectedK3dCluster(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const { environment } = repository;
  const { clusterName } = k3dCluster(environment);
  if (k3dContext(clusterName) !== environment.kubeContext) {
    throw new Error(
      `refusing unexpected cluster/context pair: ${k3dContext(clusterName)} != ${environment.kubeContext}; ${contextRemedy(clusterName)}`,
    );
  }
  const info = await listOrUnavailable(environment, runner);
  if (info.state !== "running") {
    throw unavailable(clusterName, info.state);
  }
  const result = await runner.run(
    "kubectl",
    [
      "--context",
      environment.kubeContext,
      "get",
      "namespace",
      "kube-system",
      "-o",
      "jsonpath={.metadata.name}",
    ],
    { capture: true },
  );
  if (result.stdout.trim() !== "kube-system") {
    throw new Error(
      `context ${environment.kubeContext} did not identify the expected cluster; ${contextRemedy(clusterName)}`,
    );
  }
}

export async function clusterUpK3d(
  repository: Repository,
  runner: Runner,
  readiness: ReadinessOptions,
): Promise<void> {
  const { clusterName } = k3dCluster(repository.environment);
  if (k3dContext(clusterName) !== repository.environment.kubeContext) {
    throw new Error(
      `refusing unexpected cluster/context pair: ${k3dContext(clusterName)} != ${repository.environment.kubeContext}; ${contextRemedy(clusterName)}`,
    );
  }
  const { state, entry } = await listOrUnavailable(
    repository.environment,
    runner,
  );
  if (entry !== undefined) {
    const differences = drift(entry, k3dCluster(repository.environment));
    if (differences.length > 0) {
      throw new Error(
        `k3d cluster ${clusterName} differs from the overlay (${differences.join("; ")}); recreate it with \`kore local down --prune\` then \`kore local up\``,
      );
    }
  }
  if (state === "absent") {
    await runK3d(runner, k3dCreateArgs(repository), {
      capture: false,
      cwd: repository.root,
    });
  } else if (state === "stopped") {
    await runK3d(runner, k3dStartArgs(clusterName), {
      capture: false,
      cwd: repository.root,
    });
  }
  await waitForClusterReady(repository, runner, readiness);
  await assertExpectedK3dCluster(repository, runner);
}

export async function clusterStatusK3d(
  repository: Repository,
  runner: Runner,
): Promise<Record<string, unknown>> {
  const { environment } = repository;
  const { clusterName } = k3dCluster(environment);
  const info = await listOrUnavailable(environment, runner);
  if (info.state !== "running") {
    throw unavailable(clusterName, info.state);
  }
  return {
    environment: environment.name,
    cluster: clusterName,
    context: environment.kubeContext,
    state: info.state,
    status: Object.fromEntries(
      reportedFields.map((field) => [field, info.entry?.[field]]),
    ),
  };
}
