import type { Environment, Repository } from "../config/index.js";
import { minikubeCluster } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { waitForClusterReady, type ReadinessOptions } from "./readiness.js";
import { hasVerifiedExport } from "./export-manifest.js";
import { purgeRetainedResources, retainedResources } from "./retained.js";

export class ClusterUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ClusterUnavailableError";
  }
}

export function clusterStartArgs(environment: Environment): string[] {
  const cluster = minikubeCluster(environment);
  return [
    "start",
    "--profile",
    cluster.profile,
    "--kubernetes-version",
    `v${cluster.kubernetesVersion.replace(/^v/, "")}`,
    "--driver",
    cluster.driver,
    "--container-runtime",
    cluster.containerRuntime,
    "--cpus",
    String(cluster.cpus),
    "--memory",
    String(cluster.memoryMB),
    "--disk-size",
    cluster.diskSize,
    "--apiserver-names",
    cluster.profile,
    ...(cluster.serviceCidr
      ? ["--service-cluster-ip-range", cluster.serviceCidr]
      : []),
    "--keep-context=false",
  ];
}

export async function assertExpectedCluster(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const { environment } = repository;
  if (environment.provider !== "minikube") {
    await runner.run(
      "kubectl",
      [
        "--context",
        environment.kubeContext,
        "get",
        "namespace",
        "kube-system",
        "-o",
        "name",
      ],
      { capture: true },
    );
    return;
  }
  if (minikubeCluster(environment).profile !== environment.kubeContext) {
    throw new Error(
      `refusing unexpected profile/context pair: ${minikubeCluster(environment).profile} != ${environment.kubeContext}`,
    );
  }
  try {
    await runner.run(
      "minikube",
      [
        "status",
        "--profile",
        minikubeCluster(environment).profile,
        "--output",
        "json",
      ],
      { capture: true },
    );
  } catch (error) {
    throw new ClusterUnavailableError(
      `Minikube profile ${minikubeCluster(environment).profile} is unavailable`,
      { cause: error },
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

export async function clusterUp(
  repository: Repository,
  runner: Runner,
  readiness: ReadinessOptions = {},
): Promise<void> {
  const { environment } = repository;
  if (environment.provider !== "minikube") {
    throw new Error(
      "cluster up only manages Minikube environments; provision managed clusters with OpenTofu",
    );
  }
  if (minikubeCluster(environment).profile !== environment.kubeContext) {
    throw new Error("Minikube profile and expected context must match");
  }
  await runner.run("minikube", clusterStartArgs(environment), {
    capture: false,
    cwd: repository.root,
  });
  await waitForClusterReady(repository, runner, readiness);
  await assertExpectedCluster(repository, runner);
}

export async function clusterStatus(
  repository: Repository,
  runner: Runner,
): Promise<Record<string, unknown>> {
  const { environment } = repository;
  const result =
    environment.provider === "minikube"
      ? await runner.run(
          "minikube",
          [
            "status",
            "--profile",
            minikubeCluster(environment).profile,
            "--output",
            "json",
          ],
          { capture: true },
        )
      : await runner.run(
          "kubectl",
          ["--context", environment.kubeContext, "cluster-info"],
          { capture: true },
        );
  return {
    environment: environment.name,
    profile: minikubeCluster(environment).profile,
    context: environment.kubeContext,
    status: result.stdout.trim(),
  };
}

export async function clusterStop(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  if (repository.environment.provider !== "minikube") {
    throw new Error("cluster stop is only available for Minikube environments");
  }
  await assertExpectedCluster(repository, runner);
  await runner.run(
    "minikube",
    ["stop", "--profile", minikubeCluster(repository.environment).profile],
    { capture: false },
  );
}

export async function clusterDestroy(
  repository: Repository,
  runner: Runner,
  options: { yes: boolean; purgeData: boolean },
): Promise<void> {
  if (repository.environment.provider !== "minikube") {
    throw new Error(
      "cluster destroy is only available for Minikube environments",
    );
  }
  let clusterVerified = true;
  try {
    await assertExpectedCluster(repository, runner);
  } catch (error) {
    clusterVerified = false;
    if (!options.purgeData && !(await hasVerifiedExport(repository))) {
      throw new Error(
        `destroy blocked because retained data cannot be verified on the stopped/unreachable profile: ${error instanceof Error ? error.message : String(error)}; export data or use --purge-data`,
      );
    }
  }
  const retained = clusterVerified
    ? await retainedResources(repository, runner)
    : [];
  if (retained.length && !options.purgeData) {
    throw new Error(
      `destroy blocked by retained data:\n${retained.join("\n")}\nExport it or repeat with --purge-data`,
    );
  }
  if (!options.yes) {
    throw new Error(
      "destruction requires --yes (and --purge-data when retained data exists)",
    );
  }
  if (options.purgeData && clusterVerified) {
    await purgeRetainedResources(repository, runner);
  }
  await runner.run(
    "minikube",
    [
      "delete",
      "--profile",
      minikubeCluster(repository.environment).profile,
      "--purge=false",
    ],
    { capture: false },
  );
}
