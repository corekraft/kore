import { beforeEach, expect, test, vi } from "vitest";
import { managedCluster } from "../config/index.js";
import { ClusterUnavailableError as ErrorFromModule } from "./cluster-unavailable.js";
import {
  assertExpectedCluster,
  ClusterUnavailableError,
  clusterDestroy,
  clusterStatus,
  clusterStop,
  clusterUp,
} from "./cluster.js";
import { hasVerifiedExport } from "./export-manifest.js";
import {
  assertExpectedK3dCluster,
  clusterStatusK3d,
  clusterUpK3d,
} from "./k3d-cluster.js";
import {
  clusterStopK3d,
  deleteK3dCluster,
  k3dDestroyIsNoop,
} from "./k3d-lifecycle.js";
import { purgeRetainedResources, retainedResources } from "./retained.js";
import { commandLines, fakeRepository, fakeRunner } from "./cluster-support.js";

vi.mock("../config/index.js");
vi.mock("./export-manifest.js");
vi.mock("./k3d-cluster.js");
vi.mock("./k3d-lifecycle.js");
vi.mock("./retained.js");

const READINESS = { timeoutMs: 5000 };
const HOME = "/home/u";
const repository = fakeRepository();
const managed = fakeRepository({
  provider: "managed",
  kubeContext: "production-east",
});

beforeEach(() => {
  vi.mocked(managedCluster).mockReturnValue({
    profile: "kore-local",
  } as unknown as ReturnType<typeof managedCluster>);
  vi.mocked(hasVerifiedExport).mockResolvedValue(false);
  vi.mocked(k3dDestroyIsNoop).mockResolvedValue(false);
  vi.mocked(retainedResources).mockResolvedValue([]);
  vi.mocked(assertExpectedK3dCluster).mockResolvedValue(undefined);
});

test("the cluster errors are the module's own class, so callers can tell an unavailable cluster apart", () => {
  expect(ClusterUnavailableError).toBe(ErrorFromModule);
});

test("a k3d status is the k3d domain's status, and the runner is not used directly", async () => {
  const { runner, run } = fakeRunner();
  vi.mocked(clusterStatusK3d).mockResolvedValue({ state: "running" });
  expect(await clusterStatus(repository, runner)).toEqual({ state: "running" });
  expect(clusterStatusK3d).toHaveBeenCalledWith(repository, runner);
  expect(run).not.toHaveBeenCalled();
});

test("a managed cluster's status asks the context for cluster-info and reports the profile and context", async () => {
  const { runner, run } = fakeRunner(
    () => "Kubernetes control plane is running\n",
  );
  expect(await clusterStatus(managed, runner)).toEqual({
    environment: "local",
    profile: "kore-local",
    context: "production-east",
    status: "Kubernetes control plane is running",
  });
  expect(commandLines(run)).toEqual([
    "kubectl --context production-east cluster-info",
  ]);
});

test("a k3d cluster's expected-cluster check is the k3d domain's check", async () => {
  const { runner, run } = fakeRunner();
  await assertExpectedCluster(repository, runner);
  expect(assertExpectedK3dCluster).toHaveBeenCalledWith(repository, runner);
  expect(run).not.toHaveBeenCalled();
});

test("a managed cluster's expected-cluster check reads kube-system through its configured context", async () => {
  const { runner, run } = fakeRunner();
  await assertExpectedCluster(
    fakeRepository({ provider: "managed", kubeContext: "managed-eu" }),
    runner,
  );
  expect(commandLines(run)).toEqual([
    "kubectl --context managed-eu get namespace kube-system -o name",
  ]);
  expect(run.mock.calls[0]?.[2]).toEqual({ capture: true });
});

test("a k3d up is the k3d domain's up, with the readiness bound and the home it was given", async () => {
  const { runner } = fakeRunner();
  await clusterUp(repository, runner, READINESS, HOME);
  expect(clusterUpK3d).toHaveBeenCalledWith(
    repository,
    runner,
    READINESS,
    HOME,
  );
});

test("managed clusters are never brought up here, and the up runs no command", async () => {
  const { runner, run } = fakeRunner();
  await expect(clusterUp(managed, runner)).rejects.toThrow(
    "cluster up only manages k3d environments; provision managed clusters with OpenTofu",
  );
  expect(clusterUpK3d).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a k3d stop is the k3d domain's stop, and a managed stop is refused with no command", async () => {
  const { runner, run } = fakeRunner();
  await clusterStop(repository, runner);
  expect(clusterStopK3d).toHaveBeenCalledWith(repository, runner);
  await expect(clusterStop(managed, runner)).rejects.toThrow(
    "cluster stop is only available for k3d environments",
  );
  expect(clusterStopK3d).toHaveBeenCalledTimes(1);
  expect(run).not.toHaveBeenCalled();
});

test("a managed destroy is refused before any check or deletion", async () => {
  const { runner } = fakeRunner();
  await expect(
    clusterDestroy(managed, runner, { yes: true, purgeData: true }),
  ).rejects.toThrow("cluster destroy is only available for k3d environments");
  expect(k3dDestroyIsNoop).not.toHaveBeenCalled();
  expect(deleteK3dCluster).not.toHaveBeenCalled();
});

test("destroying an absent cluster is a no-op: no retained data is searched and nothing is deleted", async () => {
  const { runner } = fakeRunner();
  vi.mocked(k3dDestroyIsNoop).mockResolvedValue(true);
  await clusterDestroy(repository, runner, { yes: true, purgeData: true });
  expect(retainedResources).not.toHaveBeenCalled();
  expect(purgeRetainedResources).not.toHaveBeenCalled();
  expect(deleteK3dCluster).not.toHaveBeenCalled();
});

test("a cluster that cannot be verified blocks destroy unless a verified export exists, naming the cause", async () => {
  const { runner } = fakeRunner();
  vi.mocked(assertExpectedK3dCluster).mockRejectedValue(
    new Error("context mismatch"),
  );
  await expect(
    clusterDestroy(repository, runner, { yes: true, purgeData: false }, HOME),
  ).rejects.toThrow(
    "destroy blocked because retained data cannot be verified on the stopped/unreachable profile: context mismatch; export data or use --purge-data",
  );
  expect(deleteK3dCluster).not.toHaveBeenCalled();
});

test("a cluster that cannot be verified still destroys when a verified export covers its data, and checks no retained data", async () => {
  const { runner } = fakeRunner();
  vi.mocked(assertExpectedK3dCluster).mockRejectedValue(
    new Error("unreachable"),
  );
  vi.mocked(hasVerifiedExport).mockResolvedValue(true);
  await clusterDestroy(
    repository,
    runner,
    { yes: true, purgeData: false },
    HOME,
  );
  expect(hasVerifiedExport).toHaveBeenCalledWith(repository);
  expect(retainedResources).not.toHaveBeenCalled();
  expect(deleteK3dCluster).toHaveBeenCalledWith(repository, runner, HOME);
});

test("retained data blocks destroy without --purge-data, listing what it found, and deletes nothing", async () => {
  const { runner } = fakeRunner();
  vi.mocked(retainedResources).mockResolvedValue(["persistentvolume/pv-1"]);
  await expect(
    clusterDestroy(repository, runner, { yes: true, purgeData: false }),
  ).rejects.toThrow(
    "destroy blocked by retained data:\npersistentvolume/pv-1\nExport it or repeat with --purge-data",
  );
  expect(deleteK3dCluster).not.toHaveBeenCalled();
});

test("destroy without --yes is refused, even with nothing retained, and deletes nothing", async () => {
  const { runner } = fakeRunner();
  await expect(
    clusterDestroy(repository, runner, { yes: false, purgeData: false }),
  ).rejects.toThrow(
    "destruction requires --yes (and --purge-data when retained data exists)",
  );
  expect(deleteK3dCluster).not.toHaveBeenCalled();
});

test("with both opt-ins, retained data is purged before the cluster is deleted, with the home it was given", async () => {
  const { runner } = fakeRunner();
  vi.mocked(retainedResources).mockResolvedValue(["persistentvolume/pv-1"]);
  await clusterDestroy(
    repository,
    runner,
    { yes: true, purgeData: true },
    HOME,
  );
  expect(purgeRetainedResources).toHaveBeenCalledWith(repository, runner);
  expect(deleteK3dCluster).toHaveBeenCalledWith(repository, runner, HOME);
  expect(
    vi.mocked(purgeRetainedResources).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(deleteK3dCluster).mock.invocationCallOrder[0] ?? 0);
});

test("a purge never runs against a cluster it could not verify", async () => {
  const { runner } = fakeRunner();
  vi.mocked(assertExpectedK3dCluster).mockRejectedValue(
    new Error("unreachable"),
  );
  await clusterDestroy(repository, runner, {
    yes: true,
    purgeData: true,
  }).catch(() => undefined);
  expect(purgeRetainedResources).not.toHaveBeenCalled();
});
