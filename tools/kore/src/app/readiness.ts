import { createHash } from "node:crypto";
import type { Repository } from "../config/index.js";
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

const rotationPath = "platform\\.kore\\.dev/rotation-id";
const rotatedAtPath = "platform\\.kore\\.dev/rotated-at";

export interface SecretWaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

interface Materialization {
  refreshed: number;
  ready: string;
  reason: string;
  refreshTime: string;
}

async function externalSecretState(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<Materialization> {
  const ready = (field: string) =>
    `{.status.conditions[?(@.type=="Ready")].${field}}`;
  const { stdout } = await runner.run(
    "kubectl",
    [
      ...namespaced(repository, name),
      "get",
      "externalsecret",
      `${name}-app`,
      "--output",
      `jsonpath={.status.refreshTime}{"|"}${ready("status")}{"|"}${ready("reason")}`,
    ],
    { capture: true },
  );
  const [refreshTime = "", status = "", reason = ""] = stdout.trim().split("|");
  return {
    refreshed: refreshTime ? Date.parse(refreshTime) : Number.NaN,
    ready: status,
    reason,
    refreshTime,
  };
}

/**
 * Before a workload release carries a new secret version, the Secret it reads
 * must already hold the rotated value. The source records when it was rotated;
 * this requests an ExternalSecret resync (kore owns that annotation, not the
 * chart) unless the ExternalSecret already refreshed after the rotation, then
 * waits, bounded, for Ready with a later refresh. It reads only annotations and
 * status, never Secret data. Returns the one-way version marker, or "" when the
 * source carries no rotation id.
 */
export async function waitForSecretSource(
  repository: Repository,
  runner: Runner,
  name: string,
  options: SecretWaitOptions = {},
): Promise<string> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      repository.environment.secrets.sourceNamespace,
      "get",
      "secret",
      `${name}-app`,
      "--ignore-not-found",
      "--output",
      `jsonpath={.metadata.annotations.${rotationPath}}{"|"}{.metadata.annotations.${rotatedAtPath}}`,
    ],
    { capture: true },
  );
  const [id = "", rotatedAt = ""] = stdout.trim().split("|");
  if (!id) {
    return "";
  }
  // Refresh times have second resolution; round the rotation up so an earlier
  // refresh within the same second is never mistaken for a later one.
  const since = rotatedAt
    ? Math.ceil(Date.parse(rotatedAt) / 1000) * 1000
    : Number.NEGATIVE_INFINITY;
  const synced = (state: Materialization): boolean =>
    state.ready === "True" && !(state.refreshed < since);
  let state = await externalSecretState(repository, runner, name);
  if (!synced(state)) {
    await runner.run(
      "kubectl",
      [
        ...namespaced(repository, name),
        "annotate",
        "externalsecret",
        `${name}-app`,
        `force-sync=${Date.now()}`,
        "--overwrite",
      ],
      { capture: true },
    );
    const deadline = Date.now() + (options.timeoutMs ?? 120000);
    do {
      await new Promise((resolve) =>
        setTimeout(resolve, options.intervalMs ?? 1000),
      );
      state = await externalSecretState(repository, runner, name);
    } while (!synced(state) && Date.now() < deadline);
    if (!synced(state)) {
      throw new Error(
        `ExternalSecret ${name}/${name}-app has not synced since the token rotation at ${rotatedAt || "an unrecorded time"}: Ready=${state.ready || "unknown"} reason=${state.reason || "none"} refreshTime=${state.refreshTime || "none"}. Check that the ClusterSecretStore ${repository.environment.secrets.storeName} is Ready and the source Secret ${repository.environment.secrets.sourceNamespace}/${name}-app exists, then rerun kore app up`,
      );
    }
  }
  return createHash("sha256").update(id).digest("hex").slice(0, 16);
}
