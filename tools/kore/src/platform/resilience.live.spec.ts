import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import {
  enabledComponents,
  loadRepository,
  type Repository,
} from "../config/index.js";
import { findRoot } from "../config/config.js";
import {
  ProcessRunner,
  type Runner,
  liveEnvironment,
} from "../runtime/index.js";
import { scaleDeployment } from "./admission-probe.js";
import { platformStatus } from "./status.js";

// Docs: docs/decisions/0035-fail-fast-readiness-diagnosis.md
// Live and opt-in: needs a running local profile (`kore local up`). It
// restarts controllers and scales the OPA authorizer to zero, restoring it in
// `finally`. Registry, verifier, and key-swap outages are proven by the
// admission specs that `npm run test:live:resilience` runs alongside
// this one. It never reads a Secret value and starts no image of its own.

/** Controllers whose restart must not disturb anything else. */
const restartable = ["cert-manager", "gatekeeper", "crossplane"];

async function until<T>(
  description: string,
  attempt: () => Promise<T | undefined>,
  seconds = 300,
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

async function brokenComponents(
  repository: Repository,
  runner: Runner,
  names: readonly string[],
): Promise<string[]> {
  const rows = await platformStatus(repository, runner, names);
  return rows
    .filter(({ status }) => status !== "ready")
    .map(({ name }) => name);
}

function deploymentOf(repository: Repository, component: string) {
  const entry = repository.catalog.components.find(
    ({ name }) => name === component,
  );
  const deployment = entry?.readiness
    .find((check) => check.startsWith("deployment/"))
    ?.split("/")[1];
  assert.ok(
    entry && deployment,
    `${component} has a deployment readiness check`,
  );
  return { namespace: entry.namespace, deployment };
}

async function rollout(
  repository: Repository,
  runner: Runner,
  namespace: string,
  deployment: string,
  action: "restart" | "status",
): Promise<void> {
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      namespace,
      "rollout",
      action,
      `deployment/${deployment}`,
      ...(action === "status" ? ["--timeout=5m"] : []),
    ],
    { capture: true },
  );
}

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 to opt into a live local profile"
      : false,
  timeout: 20 * 60 * 1000,
};

async function session() {
  const repository = await loadRepository(liveEnvironment(), await findRoot());
  const runner = new ProcessRunner();
  await assertExpectedCluster(repository, runner);
  const names = enabledComponents(repository).map(({ name }) => name);
  assert.deepEqual(
    await brokenComponents(repository, runner, names),
    [],
    "the platform must be healthy before the spec",
  );
  return { repository, runner, names };
}

for (const component of restartable) {
  test(
    `restarting the ${component} controller converges to a ready platform without manual repair`,
    live,
    async () => {
      const { repository, runner, names } = await session();
      const { namespace, deployment } = deploymentOf(repository, component);

      await rollout(repository, runner, namespace, deployment, "restart");
      await rollout(repository, runner, namespace, deployment, "status");

      await until("every component to report ready again", async () =>
        (await brokenComponents(repository, runner, names)).length === 0
          ? true
          : undefined,
      );
    },
  );
}

test(
  "an OPA authorizer outage is reported degraded for that component only, then recovers",
  live,
  async () => {
    const { repository, runner, names } = await session();
    const { namespace, deployment } = deploymentOf(
      repository,
      "opa-authorizer",
    );
    const { stdout } = await runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        "--namespace",
        namespace,
        "get",
        `deployment/${deployment}`,
        "--output=jsonpath={.spec.replicas}",
      ],
      { capture: true },
    );
    const original = Number(stdout.trim());
    assert.ok(original >= 1, "the authorizer must be running before the spec");

    try {
      await scaleDeployment(repository, runner, namespace, deployment, 0);
      const broken = await until("status to report the outage", async () => {
        const result = await brokenComponents(repository, runner, names);
        return result.length > 0 ? result : undefined;
      });
      assert.deepEqual(broken, ["opa-authorizer"]);
    } finally {
      await scaleDeployment(
        repository,
        runner,
        namespace,
        deployment,
        original,
      );
      await rollout(repository, runner, namespace, deployment, "status");
    }

    await until("every component to report ready again", async () =>
      (await brokenComponents(repository, runner, names)).length === 0
        ? true
        : undefined,
    );
  },
);
