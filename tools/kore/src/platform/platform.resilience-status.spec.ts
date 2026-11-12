import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  enabledComponents,
  loadRepository,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { platformStatus } from "./status.js";
import { healthyClusterOutput } from "./resilience-fixtures.js";
import { gatedOffReleaseAbsent } from "./webhook-fixtures.js";

// Docs: docs/decisions/0035-fail-fast-readiness-diagnosis.md
// Offline proof that a controller outage is reported per component: the broken
// component reads degraded, every other row stays ready, and status never
// mutates the cluster (Step 14, "status reports degraded capabilities").

const MUTATING =
  /\b(apply|create|delete|patch|upgrade|install|replace|scale|rollout restart)\b/;

/** Resources the deployment-style readiness checks name, e.g. `deployment/istiod`. */
function workloadChecks(repository: Repository): [string, string][] {
  return enabledComponents(repository).flatMap((component) =>
    component.readiness
      .filter((check) => /^(deployment|daemonset)\//.test(check))
      .map((check): [string, string] => [component.name, check]),
  );
}

/**
 * A cluster where everything is healthy except the named workload, which is
 * either scaled to zero or never finishes rolling out.
 */
function clusterWith(down: string | undefined, mode: "zero" | "stuck") {
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push(`${command} ${args.join(" ")}`);
      gatedOffReleaseAbsent(command, args);
      if (command === "helm") {
        return {
          stdout: JSON.stringify({ info: { status: "deployed" } }),
          stderr: "",
          code: 0,
        };
      }
      const names = down !== undefined && args.includes(down);
      if (names && mode === "stuck" && args.includes("rollout")) {
        throw new Error("timed out waiting for the condition");
      }
      if (
        names &&
        mode === "zero" &&
        args.some((a) => a.includes("availableReplicas"))
      ) {
        return { stdout: "", stderr: "", code: 0 };
      }
      return {
        stdout: healthyClusterOutput(args),
        stderr: "",
        code: 0,
      };
    },
  };
  return { runner, calls };
}

const repository = await loadRepository("local");
const names = repository.catalog.components.map(({ name }) => name);

test("every readiness-checked workload is covered by the outage scenarios", () => {
  assert.ok(workloadChecks(repository).length >= 10);
});

describe.each(["zero", "stuck"] as const)("a controller %s", (mode) => {
  // A DaemonSet cannot be scaled to zero; it has no replica count to lose.
  const checks = workloadChecks(repository).filter(
    ([, check]) => mode === "stuck" || check.startsWith("deployment/"),
  );
  for (const [owner, check] of checks) {
    test(`${check} down degrades only ${owner} and mutates nothing`, async () => {
      const { runner, calls } = clusterWith(check, mode);

      const rows = await platformStatus(repository, runner, names);

      const broken = rows.filter(
        ({ status }) => status !== "ready" && status !== "gated-off",
      );
      assert.deepEqual(
        broken.map(({ name }) => name),
        [owner],
        `only ${owner} may be reported broken`,
      );
      assert.equal(broken[0]?.status, "degraded");
      assert.match(broken[0]!.detail, new RegExp(check.split("/")[1]!));
      assert.deepEqual(
        calls.filter((call) => MUTATING.test(call)),
        [],
      );
    });
  }
});

test("the same status run is fully ready once the controller is back", async () => {
  const { runner } = clusterWith(undefined, "zero");

  const rows = await platformStatus(repository, runner, names);

  assert.deepEqual(
    rows
      .filter(({ status }) => status !== "ready" && status !== "gated-off")
      .map(({ name }) => name),
    [],
  );
  assert.deepEqual(
    rows.filter(({ status }) => status === "gated-off").map(({ name }) => name),
    ["agentgateway-crds", "agentgateway"],
    "the components the local feature flag gates off report gated-off, not ready",
  );
});
