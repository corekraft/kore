import assert from "node:assert/strict";
import { test } from "vitest";
import { livenessProbeProblems } from "./probe-tolerance.js";

const deployment = (
  name: string,
  liveness: Record<string, unknown> | undefined,
) => ({
  kind: "Deployment",
  metadata: { name },
  spec: {
    template: {
      spec: {
        containers: [
          { name: "manager", ...(liveness ? { livenessProbe: liveness } : {}) },
        ],
      },
    },
  },
});

test("a liveness probe that times out under the floor is reported by component, workload and container", () => {
  assert.deepEqual(
    livenessProbeProblems(
      "cloudnative-pg",
      [deployment("cloudnative-pg", { timeoutSeconds: 1 })],
      5,
      {},
    ),
    [
      "cloudnative-pg: Deployment/cloudnative-pg container manager livenessProbe timeoutSeconds 1 is below 5",
    ],
  );
});

test("a liveness probe without timeoutSeconds counts as the Kubernetes default of 1", () => {
  assert.equal(
    livenessProbeProblems("x", [deployment("w", {})], 5, {}).length,
    1,
  );
});

test("probes at or above the floor and workloads without liveness probes are accepted", () => {
  assert.deepEqual(
    livenessProbeProblems(
      "x",
      [deployment("a", { timeoutSeconds: 5 }), deployment("b", undefined)],
      5,
      {},
    ),
    [],
  );
});

test("an allowlisted probe is accepted only with its reason, and a stale entry is reported", () => {
  const manifests = [deployment("w", { timeoutSeconds: 1 })];
  assert.deepEqual(
    livenessProbeProblems("x", manifests, 5, {
      "x: Deployment/w container manager": "chart has no timeout knob",
    }),
    [],
  );
  assert.deepEqual(
    livenessProbeProblems("x", [deployment("w", { timeoutSeconds: 9 })], 5, {
      "x: Deployment/w container manager": "chart has no timeout knob",
    }),
    [
      "x: Deployment/w container manager is allowlisted but its liveness timeout 9 already meets 5; remove the entry",
    ],
  );
  assert.equal(
    livenessProbeProblems("x", manifests, 5, {
      "x: Deployment/w container manager": " ",
    }).length,
    1,
  );
});
