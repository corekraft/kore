import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { k3dTrustDirectory } from "../images/index.js";
import { ClusterUnavailableError } from "./cluster-unavailable.js";
import {
  assertExpectedK3dCluster,
  contextRemedy,
  k3dCluster,
  k3dContext,
  listOrUnavailable,
  runK3d,
} from "./k3d-cluster.js";
import {
  clusterStopK3d,
  deleteK3dCluster,
  k3dDestroyIsNoop,
} from "./k3d-lifecycle.js";
import { fakeRepository, fakeRunner } from "./cluster-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("../images/index.js");
vi.mock("./k3d-cluster.js");

const TRUST = "/home/u/.kore/k3d/kore-local/registry-trust";
const CLUSTER_DIR = "/home/u/.kore/k3d/kore-local";
const repository = fakeRepository();

beforeEach(() => {
  vi.mocked(k3dCluster).mockReturnValue({
    clusterName: "kore-local",
  } as ReturnType<typeof k3dCluster>);
  vi.mocked(k3dContext).mockReturnValue("k3d-kore-local");
  vi.mocked(contextRemedy).mockReturnValue("REMEDY");
  vi.mocked(k3dTrustDirectory).mockReturnValue(TRUST);
  vi.mocked(dirname).mockReturnValue(CLUSTER_DIR);
});

test("stopping a running cluster checks its identity, then stops it by name and keeps its data", async () => {
  vi.mocked(listOrUnavailable).mockResolvedValue({ state: "running" });
  const { runner } = fakeRunner();
  await clusterStopK3d(repository, runner);
  expect(assertExpectedK3dCluster).toHaveBeenCalledWith(repository, runner);
  expect(runK3d).toHaveBeenCalledWith(
    runner,
    ["cluster", "stop", "kore-local"],
    {
      capture: false,
    },
  );
});

test("stopping a stopped or absent cluster returns without checking identity or stopping anything", async () => {
  const { runner } = fakeRunner();
  for (const state of ["stopped", "absent"] as const) {
    vi.mocked(listOrUnavailable).mockResolvedValue({ state });
    await clusterStopK3d(repository, runner);
  }
  expect(assertExpectedK3dCluster).not.toHaveBeenCalled();
  expect(runK3d).not.toHaveBeenCalled();
});

test("a destroy pre-check refuses a configured context that is not the one k3d names for the cluster", async () => {
  vi.mocked(k3dContext).mockReturnValue("k3d-kore-local");
  const { runner } = fakeRunner();
  await expect(
    k3dDestroyIsNoop(fakeRepository({ kubeContext: "other" }), runner),
  ).rejects.toThrow(
    "refusing unexpected cluster/context pair: k3d-kore-local != other; REMEDY",
  );
  expect(listOrUnavailable).not.toHaveBeenCalled();
});

test("a destroy pre-check reports an absent cluster as a no-op, and a present one as work to do", async () => {
  const { runner } = fakeRunner();
  vi.mocked(listOrUnavailable).mockResolvedValueOnce({ state: "absent" });
  expect(await k3dDestroyIsNoop(repository, runner)).toBe(true);
  vi.mocked(listOrUnavailable).mockResolvedValueOnce({ state: "running" });
  expect(await k3dDestroyIsNoop(repository, runner)).toBe(false);
  vi.mocked(listOrUnavailable).mockResolvedValueOnce({ state: "stopped" });
  expect(await k3dDestroyIsNoop(repository, runner)).toBe(false);
});

test("a destroy pre-check reads the cluster list of this environment through the runner", async () => {
  const { runner } = fakeRunner();
  vi.mocked(listOrUnavailable).mockResolvedValue({ state: "absent" });
  await k3dDestroyIsNoop(repository, runner);
  expect(listOrUnavailable).toHaveBeenCalledWith(
    repository.environment,
    runner,
  );
});

test("deleting the cluster removes it by name, then removes its own host trust directory under the given home", async () => {
  const { runner } = fakeRunner();
  await deleteK3dCluster(repository, runner, "/home/u");
  expect(runK3d).toHaveBeenCalledWith(
    runner,
    ["cluster", "delete", "kore-local"],
    {
      capture: false,
    },
  );
  expect(k3dTrustDirectory).toHaveBeenCalledWith("kore-local", "/home/u");
  expect(dirname).toHaveBeenCalledWith(TRUST);
  expect(rm).toHaveBeenCalledWith(CLUSTER_DIR, {
    recursive: true,
    force: true,
  });
});

test("the trust directory is removed only after the cluster is deleted", async () => {
  const { runner } = fakeRunner();
  await deleteK3dCluster(repository, runner, "/home/u");
  const deleted = vi.mocked(runK3d).mock.invocationCallOrder[0] ?? 0;
  const removed = vi.mocked(rm).mock.invocationCallOrder[0] ?? 0;
  expect(deleted).toBeGreaterThan(0);
  expect(removed).toBeGreaterThan(deleted);
});

test("a failed cluster delete leaves the host trust directory in place", async () => {
  vi.mocked(runK3d).mockRejectedValue(
    new ClusterUnavailableError("k3d is not available"),
  );
  const { runner } = fakeRunner();
  await expect(
    deleteK3dCluster(repository, runner, "/home/u"),
  ).rejects.toBeInstanceOf(ClusterUnavailableError);
  expect(rm).not.toHaveBeenCalled();
});
