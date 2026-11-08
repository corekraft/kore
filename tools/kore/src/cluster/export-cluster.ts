import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export const RETAIN_SELECTOR = "platform.kore.dev/retention=Retain";
/** The database the PostgreSQL composition bootstraps (initdb `app`). */
export const DATABASE = "app";

export interface RetainedCluster {
  name: string;
  primary: string;
}

/** Retained CloudNativePG clusters in a namespace with their current primary. */
export async function retainedClusters(
  repository: Repository,
  runner: Runner,
  namespace: string,
): Promise<RetainedCluster[]> {
  const result = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      namespace,
      "get",
      "cluster.postgresql.cnpg.io",
      "--selector",
      RETAIN_SELECTOR,
      "-o",
      'jsonpath={range .items[*]}{.metadata.name} {.status.currentPrimary}{"\\n"}{end}',
    ],
    { capture: true },
  );
  return result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([name]) => Boolean(name))
    .map(([name, primary]) => ({ name: name!, primary: primary ?? "" }));
}

/** kubectl arguments that run a command in the cluster's primary pod. */
export function execArgs(
  repository: Repository,
  namespace: string,
  primary: string,
  options: { stdin: boolean },
  command: readonly string[],
): string[] {
  return [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    namespace,
    "exec",
    ...(options.stdin ? ["-i"] : []),
    primary,
    "--container=postgres",
    "--",
    ...command,
  ];
}
