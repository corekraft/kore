import { totalmem, cpus } from "node:os";
import { statfs } from "node:fs/promises";
import type { Repository } from "../config/index.js";
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
  minikube: ["version", "--short"],
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
const required = new Set([
  "node",
  "npm",
  "minikube",
  "kubectl",
  "helm",
  "docker",
  "cosign",
]);

function detectedVersion(output: string): string | undefined {
  return output.match(/v?(\d+\.\d+\.\d+)/)?.[1];
}
function majorMinor(value: string): string {
  return value.replace(/^v/, "").split(".").slice(0, 2).join(".");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toolStatus(tool: string, matches: boolean): CheckStatus {
  if (matches) {
    return "pass";
  }
  return required.has(tool) ? "fail" : "warn";
}

async function toolCheck(
  tool: string,
  expected: string,
  args: readonly string[],
  runner: Runner,
): Promise<Check> {
  try {
    const result = await runner.run(tool, args, { capture: true });
    const actual = detectedVersion(`${result.stdout}\n${result.stderr}`);
    const matches =
      actual !== undefined && majorMinor(actual) === majorMinor(expected);
    return {
      name: `tool:${tool}`,
      status: toolStatus(tool, matches),
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
      message: `not available: ${errorText(error)}`,
    };
  }
}

async function toolChecks(
  repository: Repository,
  runner: Runner,
): Promise<Check[]> {
  const checks: Check[] = [];
  for (const [tool, expected] of Object.entries(repository.versions.tools)) {
    const args = commands[tool];
    if (args) {
      checks.push(await toolCheck(tool, expected, args, runner));
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
  const wanted = repository.environment.cluster.cpus;
  return {
    name: "host:cpu",
    status: cpuCount >= wanted ? "pass" : "fail",
    required: true,
    message: `${cpuCount} available, ${wanted} required`,
  };
}

function hostMemoryCheck(repository: Repository): Check {
  const memoryMB = Math.floor(totalmem() / 1024 / 1024);
  const wanted = repository.environment.cluster.memoryMB;
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
    repository.environment.cluster.diskSize,
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

async function minikubeProfileCheck(
  repository: Repository,
  runner: Runner,
): Promise<Check> {
  try {
    const result = await runner.run(
      "minikube",
      ["profile", "list", "-o", "json"],
      { capture: true },
    );
    const profiles = JSON.parse(result.stdout) as {
      valid?: { Name?: string; Config?: { Name?: string } }[];
    };
    const conflicting = (profiles.valid ?? []).filter(
      (profile) =>
        (profile.Name ?? profile.Config?.Name) ===
        repository.environment.cluster.profile,
    );
    const unambiguous = conflicting.length <= 1;
    return {
      name: "minikube-profile",
      status: unambiguous ? "pass" : "fail",
      required: true,
      message: unambiguous
        ? "profile name is unambiguous"
        : "multiple matching profiles found",
    };
  } catch {
    return {
      name: "minikube-profile",
      status: "warn",
      required: false,
      message: "profile list unavailable; no running profile may exist",
    };
  }
}

export async function doctor(
  repository: Repository,
  runner: Runner,
): Promise<Check[]> {
  return [
    ...(await toolChecks(repository, runner)),
    await containerRuntimeCheck(runner),
    hostCpuCheck(repository),
    hostMemoryCheck(repository),
    await hostDiskCheck(repository),
    credentialsCheck(repository),
    await minikubeProfileCheck(repository, runner),
  ];
}

export function doctorFailed(checks: Check[]): boolean {
  return checks.some((check) => check.required && check.status === "fail");
}
