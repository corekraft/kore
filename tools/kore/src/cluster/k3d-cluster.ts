import type { Environment, K3dCluster, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { ClusterUnavailableError } from "./cluster-unavailable.js";
import { type ReadinessOptions, waitForClusterReady } from "./readiness.js";

/** The state of a k3d cluster as `k3d cluster list` reports it. */
export type K3dState = "absent" | "stopped" | "running";

export interface K3dClusterInfo {
  state: K3dState;
  /** The cluster's entry from `k3d cluster list`; absent when there is none. */
  detail?: Record<string, unknown>;
}

/** The k3d settings of an environment; fails with the cause when it has none. */
export function k3dCluster(environment: Environment): K3dCluster {
  if (environment.k3d === undefined) {
    throw new Error(
      `environment ${environment.name} has no k3d cluster settings; it is a ${environment.provider} overlay, so k3d commands do not apply to it`,
    );
  }
  return environment.k3d;
}

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
    "--wait",
  ];
}

export function k3dStartArgs(clusterName: string): string[] {
  return ["cluster", "start", clusterName, "--wait"];
}

/** Looks the configured cluster up in `k3d cluster list`; read-only. */
export async function k3dClusterInfo(
  environment: Environment,
  runner: Runner,
): Promise<K3dClusterInfo> {
  const { clusterName } = k3dCluster(environment);
  const args = ["cluster", "list", "--output", "json"];
  const { stdout } = await runner.run("k3d", args, { capture: true });
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
  const detail = (entries as Record<string, unknown>[]).find(
    (entry) => entry["name"] === clusterName,
  );
  if (detail === undefined) {
    return { state: "absent" };
  }
  const running = Number(detail["serversRunning"] ?? 0);
  return { state: running > 0 ? "running" : "stopped", detail };
}

function unavailable(clusterName: string, state: string): Error {
  return new ClusterUnavailableError(
    `k3d cluster ${clusterName} is ${state}; run \`kore local up\` to create or start it`,
  );
}

export async function assertExpectedK3dCluster(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const { environment } = repository;
  const { clusterName } = k3dCluster(environment);
  if (k3dContext(clusterName) !== environment.kubeContext) {
    throw new Error(
      `refusing unexpected cluster/context pair: ${k3dContext(clusterName)} != ${environment.kubeContext}`,
    );
  }
  let info;
  try {
    info = await k3dClusterInfo(environment, runner);
  } catch (error) {
    throw new ClusterUnavailableError(
      `k3d cluster ${clusterName} is unavailable; run \`kore local up\` once k3d works`,
      { cause: error },
    );
  }
  if (info.state !== "running") {
    throw unavailable(
      clusterName,
      info.state === "absent" ? "absent" : "stopped",
    );
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
      `context ${environment.kubeContext} did not identify the expected cluster`,
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
    throw new Error("k3d cluster and expected context must match");
  }
  const { state } = await k3dClusterInfo(repository.environment, runner);
  if (state === "absent") {
    await runner.run("k3d", k3dCreateArgs(repository), {
      capture: false,
      cwd: repository.root,
    });
  } else if (state === "stopped") {
    await runner.run("k3d", k3dStartArgs(clusterName), {
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
  const info = await k3dClusterInfo(environment, runner);
  if (info.state !== "running") {
    throw unavailable(clusterName, info.state);
  }
  return {
    environment: environment.name,
    cluster: clusterName,
    context: environment.kubeContext,
    state: info.state,
    status: info.detail,
  };
}
