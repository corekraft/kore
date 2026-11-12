import { loadRepository } from "../config/index.js";
import { expect, test, vi } from "vitest";

import { RecordingRunner } from "../runtime/runner.js";
import { platformDestroy, platformStop } from "./lifecycle.js";

const stops = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../images/index.js", () => ({
  stopRegistryForward: async () => void stops.calls.push("registry-forward"),
}));
vi.mock("../cluster/index.js", () => ({
  clusterStop: async () => void stops.calls.push("cluster-stop"),
  clusterDestroy: async () => void stops.calls.push("cluster-destroy"),
}));

test("platform stop ends the registry forward before stopping the cluster", async () => {
  stops.calls.length = 0;
  await platformStop(await loadRepository("local"), new RecordingRunner());
  expect(stops.calls).toEqual(["registry-forward", "cluster-stop"]);
});

test("platform destroy ends the registry forward before destroying", async () => {
  stops.calls.length = 0;
  await platformDestroy(await loadRepository("local"), new RecordingRunner(), {
    yes: true,
    purgeData: false,
  });
  expect(stops.calls).toEqual(["registry-forward", "cluster-destroy"]);
});

async function k3dRepository() {
  const base = await loadRepository("local");
  const { cluster: _cluster, ...environment } = base.environment;
  return {
    ...base,
    environment: {
      ...environment,
      provider: "k3d" as const,
      kubeContext: "k3d-kore-local",
      k3d: {
        clusterName: "kore-local",
        serviceCidr: "10.96.0.0/12",
        ports: [{ hostPort: 8443, loadBalancerPort: 443 }],
      },
    },
  };
}

test("platform stop ends the registry forward on k3d", async () => {
  stops.calls.length = 0;
  await platformStop(await k3dRepository(), new RecordingRunner());
  expect(stops.calls).toEqual(["registry-forward", "cluster-stop"]);
});

test("platform destroy ends the registry forward on k3d before destroying", async () => {
  stops.calls.length = 0;
  await platformDestroy(await k3dRepository(), new RecordingRunner(), {
    yes: true,
    purgeData: false,
  });
  expect(stops.calls).toEqual(["registry-forward", "cluster-destroy"]);
});
