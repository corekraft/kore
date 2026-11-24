import assert from "node:assert/strict";
import { withGatewayFlagsOff } from "../../src/testing/index.js";
import { describe, test } from "vitest";
import {
  enabledComponents,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { platformStatus } from "../../src/platform/index.js";
import {
  gatedOffReleaseAbsent,
  healthyClusterOutput,
} from "../../src/testing/index.js";

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

const repository = withGatewayFlagsOff(await loadRepository("local"));
const names = repository.catalog.components.map(({ name }) => name);

test("every readiness-checked workload is covered by the outage scenarios", () => {
  assert.ok(workloadChecks(repository).length >= 10);
});

describe.each(["zero", "stuck"] as const)("a controller %s", (mode) => {
  // A DaemonSet cannot be scaled to zero; it has no replica count to lose.
  const checks = workloadChecks(repository).filter(
    ([, check]) => mode === "stuck" || check.startsWith("deployment/"),
  );
  // A workload two components both check (Argo CD's ApplicationSet controller
  // is read by argocd and by kore-golden-path-delivery) degrades each of them.
  const owners = (check: string) =>
    checks.filter(([, c]) => c === check).map(([owner]) => owner);
  for (const check of new Set(checks.map(([, c]) => c))) {
    const expected = owners(check);
    test(`${check} down degrades only ${expected.join(" and ")} and mutates nothing`, async () => {
      const { runner, calls } = clusterWith(check, mode);

      const rows = await platformStatus(repository, runner, names);

      const broken = rows.filter(
        ({ status }) => status !== "ready" && status !== "gated-off",
      );
      assert.deepEqual(
        broken.map(({ name }) => name).sort(),
        [...expected].sort(),
        `only ${expected.join(" and ")} may be reported broken`,
      );
      for (const row of broken) {
        assert.equal(row.status, "degraded");
        assert.match(row.detail, new RegExp(check.split("/")[1]!));
      }
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
    [
      "agentgateway-crds",
      "agentgateway",
      "keycloak-operator",
      "keycloak-provider",
      "kore-hostname-ownership-templates",
      "kore-policy-sync",
      "kore-hostname-ownership",
      "kore-platform-keycloak",
      "kore-platform-backstage",
      "kore-service-observability",
      "external-dns",
      "kore-otlp-route",
      // Last: the zone rewrite needs the Gateway that kore-platform-config creates.
      "kore-platform-dns",
    ],
    "the components the local feature flag gates off report gated-off, not ready",
  );
});
