// Docs: docs/decisions/0063-lifecycle-resume-and-release-only-app-up.md
import { beforeEach, expect, test, vi } from "vitest";
import { retainedResources } from "../cluster/index.js";
import { recoverRelease } from "../platform/index.js";
import { fakeRepository, fakeRunner } from "./app-support.js";
import { cleanupInterruptedReleases } from "./cleanup.js";

vi.mock("../cluster/index.js");
vi.mock("../platform/index.js");

const repository = fakeRepository();
const { runner } = fakeRunner();

/** The pre-uninstall guard the resources release is recovered with. */
function resourcesGuard(): () => Promise<void> {
  const guard = vi.mocked(recoverRelease).mock.calls[0]?.[3];
  if (!guard) {
    throw new Error("the resources release is recovered with a guard");
  }
  return guard;
}

beforeEach(() => {
  vi.mocked(recoverRelease).mockResolvedValue({} as never);
  vi.mocked(retainedResources).mockResolvedValue([]);
});

test("cleanup recovers the failed resources release first, then the workload release, both with a ten-minute bound", async () => {
  await cleanupInterruptedReleases(repository, runner, "reference");
  expect(vi.mocked(recoverRelease).mock.calls).toEqual([
    [
      repository,
      runner,
      { name: "reference-resources", namespace: "reference", timeout: "10m" },
      expect.any(Function),
    ],
    [
      repository,
      runner,
      { name: "reference", namespace: "reference", timeout: "10m" },
    ],
  ]);
});

test("the workload release is recovered with no guard, since it holds no claim of its own", async () => {
  await cleanupInterruptedReleases(repository, runner, "reference");
  expect(vi.mocked(recoverRelease).mock.calls[1]).toHaveLength(3);
});

test("a never-deployed resources release is uninstalled when the namespace holds no retained data", async () => {
  await cleanupInterruptedReleases(repository, runner, "reference");
  await expect(resourcesGuard()()).resolves.toBeUndefined();
  expect(retainedResources).toHaveBeenCalledWith(
    repository,
    runner,
    "reference",
  );
});

test("a never-deployed resources release is refused while retained data exists, naming the data and the export to run first", async () => {
  vi.mocked(retainedResources).mockResolvedValue([
    "postgresqlinstance.platform.kore.dev/reference-db",
  ]);
  await cleanupInterruptedReleases(repository, runner, "reference");
  await expect(resourcesGuard()()).rejects.toThrow(
    /retained data exists in namespace reference \(postgresqlinstance\.platform\.kore\.dev\/reference-db\).*kore data export --environment local/s,
  );
});

test("a refused resources release stops cleanup before the workload release is touched", async () => {
  vi.mocked(retainedResources).mockResolvedValue(["claim/one"]);
  vi.mocked(recoverRelease).mockImplementation(
    async (_repo, _run, _target, guard) => {
      await guard?.();
      return {} as never;
    },
  );
  await expect(
    cleanupInterruptedReleases(repository, runner, "reference"),
  ).rejects.toThrow(/uninstalling the release would delete its claim/);
  expect(recoverRelease).toHaveBeenCalledTimes(1);
});

test("cleanup examines only the application's own releases, in its own namespace and configured context", async () => {
  await cleanupInterruptedReleases(repository, runner, "reference");
  for (const [, , target] of vi.mocked(recoverRelease).mock.calls) {
    expect(target).toMatchObject({ namespace: "reference" });
    expect(["reference", "reference-resources"]).toContain(target?.name);
  }
  expect(retainedResources).not.toHaveBeenCalled();
});
