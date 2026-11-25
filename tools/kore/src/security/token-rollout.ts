import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md, AGENTS.md "Idempotent and resumable" and "Fail closed"

// The checksum a Deployment last rolled for, set on its token Secret only once
// the rolled pod is ready, so a failed roll is retried by a rerun.
export const rolledKey = "platform.kore.dev/rolled-document-sha256";
// How long a rolled Deployment's new pod has to become ready before the run fails.
export const rolloutTimeout = "5m";

/**
 * A Deployment that reads its token at start, and the token Secret beside it:
 * the configured context and namespace they live in, the consumer's name for
 * messages, and the checksum of the document the Secret now holds.
 */
export interface RolloutTarget {
  context: string;
  name: string;
  namespace: string;
  secret: string;
  deployment: string;
  checksum: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The kubectl arguments that name a target's namespace in its configured context. */
function inContext(target: RolloutTarget): string[] {
  return ["--context", target.context, "--namespace", target.namespace];
}

/** The checksum the live token Secret records as rolled; undefined when there is no Secret or it has none. */
async function rolledChecksum(
  target: RolloutTarget,
  runner: Runner,
): Promise<string | undefined> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      ...inContext(target),
      "get",
      "secret",
      target.secret,
      "--ignore-not-found",
      "--output=json",
    ],
    { capture: true },
  );
  const secret: unknown = stdout.trim() === "" ? undefined : JSON.parse(stdout);
  const metadata = isRecord(secret) ? secret.metadata : undefined;
  const annotations = isRecord(metadata) ? metadata.annotations : undefined;
  const rolled = isRecord(annotations) ? annotations[rolledKey] : undefined;
  return typeof rolled === "string" ? rolled : undefined;
}

/**
 * Whether applying the target's document rolls its Deployment: the Deployment
 * exists, and the checksum the live Secret records as rolled is not this one.
 * Read before the Secret applies; a failed roll records nothing, so a rerun
 * answers yes again.
 */
export async function rollsDeployment(
  target: RolloutTarget,
  runner: Runner,
): Promise<boolean> {
  if ((await rolledChecksum(target, runner)) === target.checksum) {
    return false;
  }
  const { stdout } = await runner.run(
    "kubectl",
    [
      ...inContext(target),
      "get",
      `deployment/${target.deployment}`,
      "--ignore-not-found",
      "--output=name",
    ],
    { capture: true },
  );
  return stdout.trim() !== "";
}

/** Restarts the target's Deployment; a failure names the command to run by hand. */
async function restart(target: RolloutTarget, runner: Runner): Promise<void> {
  const args = [
    ...inContext(target),
    "rollout",
    "restart",
    `deployment/${target.deployment}`,
  ];
  try {
    await runner.run("kubectl", args, { capture: true });
  } catch (error) {
    throw new Error(
      `the ${target.name} token Secret was applied, but restarting its Deployment failed: ${errorText(error)}. Rerun kore secrets tokens to retry the restart, because the Secret does not record the rolled checksum until the rolled pod is ready; or restart it by hand with: kubectl ${args.join(" ")}`,
    );
  }
}

/**
 * Waits, up to the bound, for the restarted Deployment's new pod to become
 * ready; a failure names the cause and the logs command that shows why.
 */
async function awaitReady(
  target: RolloutTarget,
  runner: Runner,
): Promise<void> {
  const deployment = `deployment/${target.deployment}`;
  try {
    await runner.run(
      "kubectl",
      [
        ...inContext(target),
        "rollout",
        "status",
        deployment,
        `--timeout=${rolloutTimeout}`,
      ],
      { capture: true },
    );
  } catch (error) {
    const logs = ["kubectl", ...inContext(target), "logs", deployment];
    throw new Error(
      `the ${target.name} Deployment restarted, but its new pod did not become ready within ${rolloutTimeout}: ${errorText(error)}. Read why with: ${logs.join(" ")}; fix the token or the pod, then rerun kore secrets tokens, which restarts the Deployment again, because the Secret does not record the rolled checksum until the rolled pod is ready`,
    );
  }
}

/** Records the rolled checksum on the token Secret, never on the Helm-owned Deployment. */
async function record(target: RolloutTarget, runner: Runner): Promise<void> {
  try {
    await runner.run(
      "kubectl",
      [
        ...inContext(target),
        "annotate",
        "secret",
        target.secret,
        `${rolledKey}=${target.checksum}`,
        "--overwrite",
      ],
      { capture: true },
    );
  } catch (error) {
    throw new Error(
      `the ${target.name} Deployment rolled and is ready, but recording the rolled checksum on its token Secret failed: ${errorText(error)}. Rerun kore secrets tokens; it restarts the Deployment once more, then records the checksum`,
    );
  }
}

/**
 * Rolls the target's Deployment once, waits for its new pod to become ready,
 * then records the rolled checksum on the token Secret. The record comes only
 * after the wait passes, so a failed restart or a pod that never becomes ready
 * is retried by a rerun.
 */
export async function rollDeployment(
  target: RolloutTarget,
  runner: Runner,
): Promise<void> {
  await restart(target, runner);
  await awaitReady(target, runner);
  await record(target, runner);
}
