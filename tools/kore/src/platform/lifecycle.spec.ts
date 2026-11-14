import { expect, test, vi } from "vitest";
import { clusterDestroy, clusterStop } from "../cluster/index.js";
import { stopRegistryForward } from "../images/index.js";
import type { ProcessControl } from "../runtime/index.js";
import { platformDestroy, platformStop } from "./lifecycle.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

vi.mock("../cluster/index.js");
vi.mock("../images/index.js");

const processes: ProcessControl = {};
const local = fakeRepository();
const managed = fakeRepository({ provider: "managed" });

test("platform stop ends the registry forward before stopping the cluster", async () => {
  const { runner } = fakeRunner();
  await platformStop(local, runner, processes, { force: true });
  expect(stopRegistryForward).toHaveBeenCalledWith(local, processes, {
    force: true,
  });
  expect(clusterStop).toHaveBeenCalledWith(local, runner);
  expect(
    vi.mocked(stopRegistryForward).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(clusterStop).mock.invocationCallOrder[0]!);
});

test("platform stop never ends a registry forward on a managed environment", async () => {
  const { runner } = fakeRunner();
  await platformStop(managed, runner);
  expect(stopRegistryForward).not.toHaveBeenCalled();
  expect(clusterStop).toHaveBeenCalledWith(managed, runner);
});

test("platform stop leaves the cluster running when the registry forward cannot be ended", async () => {
  vi.mocked(stopRegistryForward).mockRejectedValueOnce(
    new Error("forward busy"),
  );
  const { runner } = fakeRunner();
  await expect(platformStop(local, runner)).rejects.toThrow("forward busy");
  expect(clusterStop).not.toHaveBeenCalled();
});

test("platform destroy ends the registry forward before destroying the cluster", async () => {
  const { runner } = fakeRunner();
  const options = { yes: true, purgeData: false, force: true };
  await platformDestroy(local, runner, options, processes);
  expect(stopRegistryForward).toHaveBeenCalledWith(local, processes, options);
  expect(clusterDestroy).toHaveBeenCalledWith(local, runner, options);
  expect(
    vi.mocked(stopRegistryForward).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(clusterDestroy).mock.invocationCallOrder[0]!);
});

test("platform destroy on a managed environment destroys the cluster and no registry forward", async () => {
  const { runner } = fakeRunner();
  await platformDestroy(managed, runner, { yes: true, purgeData: true });
  expect(stopRegistryForward).not.toHaveBeenCalled();
  expect(clusterDestroy).toHaveBeenCalledWith(managed, runner, {
    yes: true,
    purgeData: true,
  });
});
