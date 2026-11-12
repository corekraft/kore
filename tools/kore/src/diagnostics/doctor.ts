import { totalmem, cpus } from "node:os";
import { statfs } from "node:fs/promises";
import type { Repository } from "../config/index.js";
import { managedCluster } from "../config/index.js";
import { k3dClusterInfo } from "../cluster/index.js";
import type { Runner } from "../runtime/index.js";

export type CheckStatus = "pass" | "warn" | "fail";
export interface Check {
  name: string;
  status: CheckStatus;
  message: string;
  required: boolean;
}

const commands: Record<string, readonly string[]> = {
  node: ["--version"],
  npm: ["--version"],
  k3d: ["version"],
  kubectl: ["version", "--client=true", "-o", "json"],
  helm: ["version", "--short"],
  yq: ["--version"],
  sops: ["--version"],
  age: ["--version"],
  mkcert: ["--version"],
  cosign: ["version"],
  tofu: ["version"],
  opa: ["version"],
  docker: ["--version"],
};
const alwaysRequired = ["node", "npm", "kubectl", "helm", "docker", "cosign"];

/** The cluster tool a local provider needs; a managed environment needs none. */
const providerTool: Record<string, string | undefined> = { k3d: "k3d" };
const clusterTools = Object.values(providerTool) as string[];

function requiredTools(repository: Repository): Set<string> {
  const tool = providerTool[repository.environment.provider];
  return new Set(tool ? [...alwaysRequired, tool] : alwaysRequired);
}

function detectedVersion(output: string): string | undefined {
  return output.match(/v?(\d+\.\d+\.\d+)/)?.[1];
}
function majorMinor(value: string): string {
  return value.replace(/^v/, "").split(".").slice(0, 2).join(".");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toolStatus(
  required: Set<string>,
  tool: string,
  matches: boolean,
): CheckStatus {
  if (matches) {
    return "pass";
  }
  return required.has(tool) ? "fail" : "warn";
}

const installRemedy = "install the pinned version with `mise install`";

function unavailableMessage(error: unknown): string {
  const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
  return `not available: ${errorText(error)}${missing ? `; ${installRemedy}` : ""}`;
}

async function toolCheck(
  tool: string,
  expected: string,
  args: readonly string[],
  runner: Runner,
  required: Set<string>,
): Promise<Check> {
  try {
    const result = await runner.run(tool, args, { capture: true });
    const actual = detectedVersion(`${result.stdout}\n${result.stderr}`);
    const matches =
      actual !== undefined && majorMinor(actual) === majorMinor(expected);
    return {
      name: `tool:${tool}`,
      status: toolStatus(required, tool, matches),
      required: required.has(tool),
      message: matches
        ? `${actual} (pinned ${expected})`
        : `found ${actual ?? "unknown"}, expected ${expected}`,
    };
  } catch (error) {
    return {
      name: `tool:${tool}`,
      status: required.has(tool) ? "fail" : "warn",
      required: required.has(tool),
      message: unavailableMessage(error),
    };
  }
}

async function toolChecks(
  repository: Repository,
  runner: Runner,
): Promise<Check[]> {
  const checks: Check[] = [];
  const required = requiredTools(repository);
  for (const [tool, expected] of Object.entries(repository.versions.tools)) {
    const args = commands[tool];
    // A provider needs only its own cluster tool, so the other is not a finding.
    if (args && (!clusterTools.includes(tool) || required.has(tool))) {
      checks.push(await toolCheck(tool, expected, args, runner, required));
    }
  }
  return checks;
}

async function containerRuntimeCheck(runner: Runner): Promise<Check> {
  try {
    await runner.run("docker", ["info", "--format", "{{.ServerVersion}}"], {
      capture: true,
    });
    return {
      name: "container-runtime",
      status: "pass",
      required: true,
      message: "Docker daemon is reachable",
    };
  } catch (error) {
    return {
      name: "container-runtime",
      status: "fail",
      required: true,
      message: `Docker daemon is unavailable: ${errorText(error)}`,
    };
  }
}

function hostCpuCheck(repository: Repository): Check {
  const cpuCount = cpus().length;
  const wanted = managedCluster(repository.environment).cpus;
  return {
    name: "host:cpu",
    status: cpuCount >= wanted ? "pass" : "fail",
    required: true,
    message: `${cpuCount} available, ${wanted} required`,
  };
}

function hostMemoryCheck(repository: Repository): Check {
  const memoryMB = Math.floor(totalmem() / 1024 / 1024);
  const wanted = managedCluster(repository.environment).memoryMB;
  return {
    name: "host:memory",
    status: memoryMB >= wanted ? "pass" : "fail",
    required: true,
    message: `${memoryMB} MiB available, ${wanted} MiB required`,
  };
}

async function hostDiskCheck(repository: Repository): Promise<Check> {
  const fs = await statfs(repository.root);
  const freeGB = Math.floor(Number(fs.bavail * fs.bsize) / 1024 ** 3);
  const requestedGB = Number.parseInt(
    managedCluster(repository.environment).diskSize,
    10,
  );
  return {
    name: "host:disk",
    status: freeGB >= requestedGB ? "pass" : "fail",
    required: true,
    message: `${freeGB} GiB free, ${requestedGB} GiB required`,
  };
}

function credentialsCheck(repository: Repository): Check {
  const { provider, kubeContext } = repository.environment;
  if (provider !== "managed") {
    return {
      name: "credentials",
      status: "pass",
      required: false,
      message: "local environment needs no cloud credentials",
    };
  }
  const missing = kubeContext === "REQUIRED";
  return {
    name: "credentials",
    status: missing ? "fail" : "pass",
    required: true,
    message: missing
      ? "managed environment credentials/context are not configured"
      : "managed context is configured",
  };
}

async function k3dClusterCheck(
  repository: Repository,
  runner: Runner,
): Promise<Check> {
  const name = repository.environment.k3d?.clusterName ?? "(unset)";
  const base = { name: "k3d-cluster", required: false } as const;
  try {
    const { state } = await k3dClusterInfo(repository.environment, runner);
    if (state === "running") {
      return { ...base, status: "pass", message: `${name} is running` };
    }
    return {
      ...base,
      status: "warn",
      message:
        state === "absent"
          ? `${name} is absent; run \`kore local up\` to create it`
          : `${name} is stopped; run \`kore local up\` to start it`,
    };
  } catch (error) {
    return {
      ...base,
      status: "warn",
      message: `k3d cluster ${name} could not be listed: ${errorText(error)}`,
    };
  }
}

/**
 * Read-only: every probe is a version or list call, run before anything
 * mutates. A k3d overlay checks k3d, docker and the cluster; the host sizing
 * checks apply only to a managed environment, which declares its sizing.
 */
export async function doctor(
  repository: Repository,
  runner: Runner,
): Promise<Check[]> {
  const k3d = repository.environment.provider === "k3d";
  return [
    ...(await toolChecks(repository, runner)),
    await containerRuntimeCheck(runner),
    ...(k3d
      ? []
      : [
          hostCpuCheck(repository),
          hostMemoryCheck(repository),
          await hostDiskCheck(repository),
        ]),
    credentialsCheck(repository),
    ...(k3d ? [await k3dClusterCheck(repository, runner)] : []),
  ];
}

export function doctorFailed(checks: Check[]): boolean {
  return checks.some((check) => check.required && check.status === "fail");
}
