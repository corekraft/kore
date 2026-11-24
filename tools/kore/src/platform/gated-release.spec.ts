// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { beforeEach, expect, test, vi } from "vitest";
import { componentGatedOff, enabledComponents } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { errorMessage, helmReleaseStatus } from "./probe.js";
import {
  assertNoOrphanedReleases,
  gatedReleaseProblem,
  managedNamespaces,
  orphanedGatedComponents,
} from "./gated-release.js";
import { componentOf, repositoryOf, runnerFake } from "./gate-unit-support.js";

vi.mock("../config/index.js");
vi.mock("./probe.js");

const environment = { name: "k3d-local", kubeContext: "k3d-kore-local" };
const repository = repositoryOf(environment);
const gatedOff = componentOf("registry", {
  namespace: "registry-ns",
  featureFlag: "registry",
});
const notFound = new CommandError("helm", ["status"], {
  stdout: "",
  stderr: "Error: release: not found",
  code: 1,
});

beforeEach(() => {
  vi.mocked(componentGatedOff).mockReturnValue(false);
  vi.mocked(enabledComponents).mockReturnValue([]);
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
});

test("a manifest component has no release to look up, so it is never a problem", async () => {
  const { runner } = runnerFake();
  const manifest = componentOf("policy-templates", { kind: "manifest" });

  const problem = await gatedReleaseProblem(repository, runner, manifest);

  expect(problem).toBeUndefined();
  expect(helmReleaseStatus).not.toHaveBeenCalled();
});

test("a gated-off component whose release is not found is clean", async () => {
  const { runner } = runnerFake();
  vi.mocked(helmReleaseStatus).mockRejectedValue(notFound);

  const problem = await gatedReleaseProblem(repository, runner, gatedOff);

  expect(problem).toBeUndefined();
});

test("a gated-off release still installed is named with the uninstall and the flag to turn back on", async () => {
  const { runner } = runnerFake();
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");

  const problem = await gatedReleaseProblem(repository, runner, gatedOff);

  expect(problem).toBe(
    "registry is gated off (feature registry is off in k3d-local) but its release is still installed in registry-ns; run kore platform uninstall registry --environment k3d-local --yes to remove it, or turn feature registry back on",
  );
});

test("a status failure other than not-found is a problem that says kore cannot check, never a clean gated-off", async () => {
  const { runner } = runnerFake();
  const denied = new Error("forbidden: cannot read secrets");
  vi.mocked(helmReleaseStatus).mockRejectedValue(denied);
  vi.mocked(errorMessage).mockReturnValue("forbidden: cannot read secrets");

  const problem = await gatedReleaseProblem(repository, runner, gatedOff);

  expect(errorMessage).toHaveBeenCalledWith(denied);
  expect(problem).toBe(
    "registry is gated off (feature registry is off in k3d-local) but kore cannot check whether its release remains in registry-ns: forbidden: cannot read secrets",
  );
});

test("only gated-off components are checked, and only those with a release still there are returned", async () => {
  const { runner } = runnerFake();
  const enabled = componentOf("ingress");
  const orphan = componentOf("cache", { featureFlag: "cache" });
  const clean = componentOf("queue", { featureFlag: "queue" });
  vi.mocked(componentGatedOff).mockImplementation(
    (_environment, component) => component !== enabled,
  );
  vi.mocked(helmReleaseStatus).mockImplementation(
    async (_repository, _runner, component) => {
      if (component === clean) {
        throw notFound;
      }
      return "deployed";
    },
  );
  const repo = repositoryOf(environment, [enabled, orphan, clean]);

  const orphans = await orphanedGatedComponents(repo, runner);

  expect(orphans.map(({ component }) => component.name)).toEqual(["cache"]);
  expect(helmReleaseStatus).not.toHaveBeenCalledWith(repo, runner, enabled);
});

test("assertNoOrphanedReleases resolves when no gated-off release remains", async () => {
  const { runner } = runnerFake();
  const repo = repositoryOf(environment, [gatedOff]);
  vi.mocked(componentGatedOff).mockReturnValue(true);
  vi.mocked(helmReleaseStatus).mockRejectedValue(notFound);

  await expect(assertNoOrphanedReleases(repo, runner)).resolves.toBeUndefined();
});

test("assertNoOrphanedReleases fails once, joining every problem, before any install", async () => {
  const { runner } = runnerFake();
  const second = componentOf("cache", { featureFlag: "cache" });
  const repo = repositoryOf(environment, [gatedOff, second]);
  vi.mocked(componentGatedOff).mockReturnValue(true);
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");

  await expect(assertNoOrphanedReleases(repo, runner)).rejects.toThrow(
    /^registry is gated off .*; cache is gated off /,
  );
});

test("managedNamespaces covers enabled components and gated-off releases still present, sorted and unique", async () => {
  const { runner } = runnerFake();
  const ingress = componentOf("ingress", { namespace: "zeta" });
  const sameNamespace = componentOf("api", { namespace: "alpha" });
  const repo = repositoryOf(environment, [ingress, sameNamespace, gatedOff]);
  vi.mocked(enabledComponents).mockReturnValue([ingress, sameNamespace]);
  vi.mocked(componentGatedOff).mockImplementation(
    (_environment, component) => component === gatedOff,
  );
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");

  const namespaces = await managedNamespaces(repo, runner);

  expect(namespaces).toEqual(["alpha", "registry-ns", "zeta"]);
});
