import { expect, test, vi } from "vitest";
import { loadRepository } from "../config/index.js";
import { RecordingRunner } from "../runtime/runner.js";
import { platformDestroy, platformStop } from "./lifecycle.js";

const stops = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("../tunnel/index.js", () => ({
  stopLocalTunnel: async () => void stops.calls.push("tunnel"),
}));
vi.mock("../images/index.js", () => ({
  stopRegistryForward: async () => void stops.calls.push("registry-forward"),
}));
vi.mock("../cluster/index.js", () => ({
  clusterStop: async () => void stops.calls.push("cluster-stop"),
  clusterDestroy: async () => void stops.calls.push("cluster-destroy"),
}));

test("platform stop terminates the tunnel and registry forward before stopping the cluster", async () => {
  stops.calls.length = 0;
  await platformStop(await loadRepository("local"), new RecordingRunner());
  expect(stops.calls).toEqual(["tunnel", "registry-forward", "cluster-stop"]);
});

test("platform destroy terminates the tunnel and registry forward before destroying", async () => {
  stops.calls.length = 0;
  await platformDestroy(await loadRepository("local"), new RecordingRunner(), {
    yes: true,
    purgeData: false,
  });
  expect(stops.calls).toEqual([
    "tunnel",
    "registry-forward",
    "cluster-destroy",
  ]);
});
