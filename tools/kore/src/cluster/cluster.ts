import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Environment, Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

export class ClusterUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ClusterUnavailableError";
  }
}

export function clusterStartArgs(environment: Environment): string[] {
  const cluster = environment.cluster;
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
  if (environment.cluster.profile !== environment.kubeContext) {
    throw new Error(
      `refusing unexpected profile/context pair: ${environment.cluster.profile} != ${environment.kubeContext}`,
    );
  }
  try {
    await runner.run(
      "minikube",
      ["status", "--profile", environment.cluster.profile, "--output", "json"],
      { capture: true },
    );
  } catch (error) {
    throw new ClusterUnavailableError(
      `Minikube profile ${environment.cluster.profile} is unavailable`,
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
): Promise<void> {
  const { environment } = repository;
  if (environment.provider !== "minikube") {
    throw new Error(
      "cluster up only manages Minikube environments; provision managed clusters with OpenTofu",
    );
  }
  if (environment.cluster.profile !== environment.kubeContext) {
    throw new Error("Minikube profile and expected context must match");
  }
  await runner.run("minikube", clusterStartArgs(environment), {
    capture: false,
    cwd: repository.root,
  });
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
            environment.cluster.profile,
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
    profile: environment.cluster.profile,
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
    ["stop", "--profile", repository.environment.cluster.profile],
    { capture: false },
  );
}

function isResourceTypeMissing(error: unknown): boolean {
  return /the server doesn't have a resource type/i.test(errorText(error));
}

function errorText(error: unknown): string {
  if (error instanceof CommandError) {
    return error.result.stderr;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function retainedResources(
  repository: Repository,
  runner: Runner,
): Promise<string[]> {
  const context = repository.environment.kubeContext;
  const queries = [
    [
      "--context",
      context,
      "get",
      "postgresqlinstances.platform.kore.dev",
      "--all-namespaces",
      "-l",
      "platform.kore.dev/retention=Retain",
      "-o",
      "name",
    ],
    [
      "--context",
      context,
      "get",
      "pvc",
      "--all-namespaces",
      "-l",
      "platform.kore.dev/retention=Retain",
      "-o",
      "name",
    ],
  ];
  const retained: string[] = [];
  for (const args of queries) {
    try {
      const result = await runner.run("kubectl", args, { capture: true });
      retained.push(
        ...result.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );
    } catch (error) {
      // An API that is not installed cannot contain retained data; any other
      // failure (unreachable cluster, wrong context) must refuse the destroy.
      if (!isResourceTypeMissing(error)) {
        throw error;
      }
    }
  }
  return [...new Set(retained)].sort();
}

async function purgeRetainedResources(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const context = repository.environment.kubeContext;
  const selector = "platform.kore.dev/retention=Retain";
  for (const resource of ["postgresqlinstances.platform.kore.dev", "pvc"]) {
    try {
      await runner.run(
        "kubectl",
        [
          "--context",
          context,
          "delete",
          resource,
          "--all-namespaces",
          "--selector",
          selector,
          "--ignore-not-found",
          "--wait",
        ],
        { capture: true },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        !/doesn't have a resource type|the server doesn't have a resource type|no matches for kind/i.test(
          detail,
        )
      ) {
        throw error;
      }
    }
  }
}

export async function hasVerifiedExport(
  repository: Repository,
): Promise<boolean> {
  const directory = join(
    repository.root,
    ".kore",
    "exports",
    repository.environment.name,
  );
  try {
    const checksums = (await readdir(directory)).filter((entry) =>
      entry.endsWith(".sha256"),
    );
    for (const checksumFile of checksums) {
      const line = (
        await readFile(join(directory, checksumFile), "utf8")
      ).trim();
      const match = line.match(/^([a-f0-9]{64})(?:\s+\*?(.+))?$/i);
      if (!match) {
        continue;
      }
      const expected = match[1];
      if (!expected) {
        continue;
      }
      const exportName =
        match[2]?.trim() || checksumFile.slice(0, -".sha256".length);
      const contents = await readFile(join(directory, exportName));
      const actual = createHash("sha256").update(contents).digest("hex");
      if (actual.toLowerCase() === expected.toLowerCase()) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
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
      repository.environment.cluster.profile,
      "--purge=false",
    ],
    { capture: false },
  );
}
