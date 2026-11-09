import assert from "node:assert/strict";
import test from "node:test";
import { appStatus } from "../app/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository, type Repository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { ProcessRunner, type Runner } from "../runtime/index.js";
import {
  admissionVerdict,
  deployedImage,
  scaleDeployment,
} from "./admission-probe.js";
import { platformStatus } from "./status.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// Live and opt-in: needs a running local profile with the `reference`
// application up. It scales the registry to zero and restores it in `finally`.
// Status commands stay read-only throughout; only this spec mutates.

const namespace = "reference";
const registryNamespace = "kore-registry";

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

async function registryStatus(repository: Repository, runner: Runner) {
  return (await platformStatus(repository, runner, ["oci-registry"]))[0]!;
}

async function replicas(
  repository: Repository,
  runner: Runner,
): Promise<number> {
  const { stdout } = await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      registryNamespace,
      "get",
      "deployment/oci-registry",
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
): Promise<void> {
  const denied = await until(
    "admission to deny the signed image while the registry is down",
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
    "status to report the registry degraded",
    async () => {
      const status = await registryStatus(repository, runner);
      return status.status === "degraded" ? status : undefined;
    },
  );
  assert.match(degraded.detail, /deployment\/oci-registry/);

  const app = await appStatus(repository, runner, namespace);
  assert.equal(app["status"], "degraded");
  assert.deepEqual(
    (app["degraded"] as { component: string }[]).map((c) => c.component),
    ["oci-registry"],
  );
}

async function restoreRegistry(
  repository: Repository,
  runner: Runner,
  replicaCount: number,
): Promise<void> {
  await scaleDeployment(
    repository,
    runner,
    registryNamespace,
    "oci-registry",
    replicaCount,
  );
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      registryNamespace,
      "rollout",
      "status",
      "deployment/oci-registry",
      "--timeout=5m",
    ],
    { capture: true },
  );
}

test(
  "an unavailable registry denies new signed workloads and is reported degraded, then recovers",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
        : false,
    timeout: 20 * 60 * 1000,
  },
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);

    const signed = await deployedImage(repository, runner, namespace);
    const original = await replicas(repository, runner);
    assert.ok(original >= 1, "the registry must be running before the spec");
    assert.equal(
      (await admissionVerdict(repository, runner, namespace, signed)).admitted,
      true,
      "the kore-signed image is admitted while the registry is up",
    );
    assert.equal((await registryStatus(repository, runner)).status, "ready");

    try {
      await scaleDeployment(
        repository,
        runner,
        registryNamespace,
        "oci-registry",
        0,
      );
      await assertDeniedAndDegraded(repository, runner, signed);
    } finally {
      await restoreRegistry(repository, runner, original);
    }

    await until("status to report the registry ready again", async () =>
      (await registryStatus(repository, runner)).status === "ready"
        ? true
        : undefined,
    );
    await until("admission to accept the signed image again", async () =>
      (await admissionVerdict(repository, runner, namespace, signed)).admitted
        ? true
        : undefined,
    );
  },
);
