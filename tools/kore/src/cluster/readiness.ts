import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

export interface ReadinessOptions {
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const nodeReadyJsonpath =
  'jsonpath={range .items[*]}{.metadata.name}={.status.conditions[?(@.type=="Ready")].status}{"\\n"}{end}';

function describeFailure(error: unknown): string {
  if (error instanceof CommandError) {
    return error.result.stderr.trim() || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

async function apiServerProblem(
  runner: Runner,
  context: string,
): Promise<string | undefined> {
  await runner.run(
    "kubectl",
    ["--context", context, "get", "--raw", "/readyz"],
    {
      capture: true,
    },
  );
  return undefined;
}

async function nodeProblem(
  runner: Runner,
  context: string,
): Promise<string | undefined> {
  const { stdout } = await runner.run(
    "kubectl",
    ["--context", context, "get", "nodes", "-o", nodeReadyJsonpath],
    { capture: true },
  );
  const rows = stdout.trim().split("\n").filter(Boolean);
  if (rows.length === 0) {
    return "no node has registered";
  }
  const notReady = rows.filter((row) => !row.endsWith("=True"));
  return notReady.length
    ? `node ${notReady.map((row) => row.split("=")[0]).join(", ")} is not Ready`
    : undefined;
}

function statusCommand({ environment }: Repository): string {
  return `k3d cluster list ${environment.k3d?.clusterName ?? ""}`;
}

/**
 * After a start (notably of a stopped profile) the API server, etcd and the
 * node settle for a while, and applies made earlier time out. Waits, bounded,
 * for /readyz and a Ready node, and on timeout names what was not ready.
 */
export async function waitForClusterReady(
  repository: Repository,
  runner: Runner,
  options: ReadinessOptions = {},
): Promise<void> {
  const context = repository.environment.kubeContext;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const intervalMs = options.intervalMs ?? 3000;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    (async (ms: number) =>
      await new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + timeoutMs;
  const probes = [
    { name: "API server (/readyz)", check: apiServerProblem },
    { name: "node", check: nodeProblem },
  ];
  for (const probe of probes) {
    for (;;) {
      let problem: string | undefined;
      try {
        problem = await probe.check(runner, context);
      } catch (error) {
        problem = describeFailure(error);
      }
      if (problem === undefined) {
        break;
      }
      if (now() + intervalMs > deadline) {
        throw new Error(
          `cluster ${context} was started but the ${probe.name} was not ready within ${Math.round(timeoutMs / 1000)}s: ${problem.split("\n")[0]}. Nothing was applied; check \`${statusCommand(repository)}\` and rerun.`,
        );
      }
      await sleep(intervalMs);
    }
  }
}
