import type { Repository } from "../config/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import {
  admissionGateStatusName,
  assertAdmissionGateOpen,
  imageInventoryStatusName,
  platformStatus,
} from "../platform/index.js";
import type { Runner } from "../runtime/index.js";

export function deploymentRolloutStatusArgs(name: string): string[] {
  return ["rollout", "status", `deployment/${name}`, "--timeout=10m"];
}

export function deploymentListArgs(): string[] {
  return ["get", "deployment", "--output=name"];
}

export async function assertPlatformReady(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const platform = await platformStatus(repository, runner);
  const unavailable = platform.filter(
    (component) =>
      component.name !== admissionGateStatusName &&
      // The inventory is checked before the gate opens; the gate is the record.
      component.name !== imageInventoryStatusName &&
      component.status !== "ready",
  );
  if (unavailable.length) {
    throw new Error(
      `platform is not ready: ${unavailable.map((component) => `${component.name} (${component.detail})`).join(", ")}`,
    );
  }
}

/**
 * Refuses application admission unless the gate is open for the current
 * platform generation (ADR 0054); returns the generation to activate under.
 */
export async function assertApplicationAdmission(
  repository: Repository,
  runner: Runner,
): Promise<string> {
  return await assertAdmissionGateOpen(repository, runner);
}

/** Everything `app up` requires before it touches an application: the expected cluster, a ready platform, an open gate. Returns the generation to activate under. */
export async function assertAppAdmissible(
  repository: Repository,
  runner: Runner,
): Promise<string> {
  await assertExpectedCluster(repository, runner);
  await assertPlatformReady(repository, runner);
  return await assertApplicationAdmission(repository, runner);
}

function namespaced(repository: Repository, name: string): string[] {
  return ["--context", repository.environment.kubeContext, "--namespace", name];
}

/** Blocks until the resources release has produced databases and secrets. */
export async function waitForResources(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<void> {
  const scope = namespaced(repository, name);
  await runner.run(
    "kubectl",
    [
      ...scope,
      "wait",
      "--for=condition=Ready",
      "postgresqlinstances.platform.kore.dev",
      "--all",
      "--timeout=15m",
    ],
    { capture: false },
  );
  await runner.run(
    "kubectl",
    [
      ...scope,
      "wait",
      "--for=jsonpath={.data}",
      "secret",
      "--selector",
      `app.kubernetes.io/part-of=${name}`,
      "--timeout=5m",
    ],
    { capture: false },
  );
}

/** Blocks until every workload deployment has finished rolling out. */
export async function waitForRollouts(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<void> {
  const scope = namespaced(repository, name);
  const deployments = await runner.run(
    "kubectl",
    [...scope, ...deploymentListArgs()],
    { capture: true },
  );
  for (const deployment of deployments.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)) {
    const deploymentName = deployment.replace(/^deployment(?:\.apps)?\//, "");
    await runner.run(
      "kubectl",
      [...scope, ...deploymentRolloutStatusArgs(deploymentName)],
      { capture: false },
    );
  }
}
