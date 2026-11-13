import assert from "node:assert/strict";
import test from "node:test";
import { appStatus } from "../app/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository, type Repository } from "../config/index.js";
import { findRoot } from "../config/index.js";
import {
  ProcessRunner,
  type Runner,
  integrationEnvironment,
} from "../runtime/index.js";
import {
  admissionVerdict,
  deployedImage,
  scaleDeployment,
} from "./admission-probe.js";
import { platformStatus } from "./status.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// Live and opt-in: needs a running local profile with the `reference`
// application up. It scales the registry, then the Policy Controller webhook,
// to zero and restores each in `finally`.
// Status commands stay read-only throughout; only this spec mutates.

const namespace = "reference";

/** A component whose outage must deny new workloads and show as degraded. */
interface Outage {
  component: string;
  namespace: string;
  deployment: string;
}

const registry: Outage = {
  component: "oci-registry",
  namespace: "kore-registry",
  deployment: "oci-registry",
};
// The webhook deployment is the catalog's readiness check for the component.
const verifier: Outage = {
  component: "policy-controller",
  namespace: "cosign-system",
  deployment: "policy-controller-webhook",
};

async function until<T>(
  description: string,
  attempt: () => Promise<T | undefined>,
  seconds = 180,
): Promise<T> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await attempt();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`timed out after ${seconds}s waiting for ${description}`);
}

async function componentStatus(
  repository: Repository,
  runner: Runner,
  outage: Outage,
) {
  return (await platformStatus(repository, runner, [outage.component]))[0]!;
}

async function replicas(
  repository: Repository,
  runner: Runner,
  outage: Outage,
): Promise<number> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      outage.namespace,
      "get",
      `deployment/${outage.deployment}`,
      "--output=jsonpath={.spec.replicas}",
    ],
    { capture: true },
  );
  return Number(stdout.trim());
}

async function assertDeniedAndDegraded(
  repository: Repository,
  runner: Runner,
  signed: string,
  outage: Outage,
): Promise<void> {
  const denied = await until(
    `admission to deny the signed image while ${outage.component} is down`,
    async () => {
      const verdict = await admissionVerdict(
        repository,
        runner,
        namespace,
        signed,
      );
      return verdict.admitted ? undefined : verdict;
    },
  );
  assert.ok(denied.detail.length > 0, "the denial carries a message");

  const degraded = await until(
    `status to report ${outage.component} degraded`,
    async () => {
      const status = await componentStatus(repository, runner, outage);
      return status.status === "degraded" ? status : undefined;
    },
  );
  assert.match(degraded.detail, new RegExp(`deployment/${outage.deployment}`));

  const app = await appStatus(repository, runner, namespace);
  assert.equal(app["status"], "degraded");
  assert.deepEqual(
    (app["degraded"] as { component: string }[]).map((c) => c.component),
    [outage.component],
  );
}

async function restore(
  repository: Repository,
  runner: Runner,
  outage: Outage,
  replicaCount: number,
): Promise<void> {
  await scaleDeployment(
    repository,
    runner,
    outage.namespace,
    outage.deployment,
    replicaCount,
  );
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      outage.namespace,
      "rollout",
      "status",
      `deployment/${outage.deployment}`,
      "--timeout=5m",
    ],
    { capture: true },
  );
}

/**
 * Takes `outage` down, asserts new signed workloads are denied (fail closed)
 * and status names it degraded, and always brings it back and waits for
 * admission and status to recover.
 */
async function proveOutage(outage: Outage): Promise<void> {
  const repository = await loadRepository(
    integrationEnvironment(),
    await findRoot(),
  );
  const runner = new ProcessRunner();
  await assertExpectedCluster(repository, runner);

  const signed = await deployedImage(repository, runner, namespace);
  const original = await replicas(repository, runner, outage);
  assert.ok(
    original >= 1,
    `${outage.component} must be running before the spec`,
  );
  assert.equal(
    (await admissionVerdict(repository, runner, namespace, signed)).admitted,
    true,
    `the kore-signed image is admitted while ${outage.component} is up`,
  );
  assert.equal(
    (await componentStatus(repository, runner, outage)).status,
    "ready",
  );

  try {
    await scaleDeployment(
      repository,
      runner,
      outage.namespace,
      outage.deployment,
      0,
    );
    await assertDeniedAndDegraded(repository, runner, signed, outage);
  } finally {
    await restore(repository, runner, outage, original);
  }

  await until(`status to report ${outage.component} ready again`, async () =>
    (await componentStatus(repository, runner, outage)).status === "ready"
      ? true
      : undefined,
  );
  await until("admission to accept the signed image again", async () =>
    (await admissionVerdict(repository, runner, namespace, signed)).admitted
      ? true
      : undefined,
  );
}

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 20 * 60 * 1000,
};

test(
  "an unavailable registry denies new signed workloads and is reported degraded, then recovers",
  live,
  async () => await proveOutage(registry),
);

test(
  "an unavailable verifier fails closed: new signed workloads are denied and policy-controller is reported degraded, then recovers",
  live,
  async () => await proveOutage(verifier),
);
