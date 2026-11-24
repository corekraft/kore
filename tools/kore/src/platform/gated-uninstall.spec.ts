// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { beforeEach, expect, test, vi } from "vitest";
import { componentGatedOff } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { purgeRetainedResources, retainedResources } from "../cluster/index.js";
import { errorMessage, helmReleaseStatus } from "./probe.js";
import { uninstallGatedRelease } from "./gated-uninstall.js";
import { componentOf, repositoryOf, runnerFake } from "./gate-unit-support.js";

vi.mock("../config/index.js");
vi.mock("../cluster/index.js");
vi.mock("./probe.js");

const environment = { name: "k3d-local", kubeContext: "k3d-kore-local" };
const registry = componentOf("registry", {
  namespace: "registry-ns",
  featureFlag: "registry",
  timeout: "5m",
});
const notFound = new CommandError("helm", ["status"], {
  stdout: "",
  stderr: "Error: release: not found",
  code: 1,
});
const none = { yes: false, purgeData: false };
const consent = { yes: true, purgeData: false };
const purge = { yes: true, purgeData: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(componentGatedOff).mockReturnValue(true);
  vi.mocked(retainedResources).mockResolvedValue([]);
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
});

test("a name that is not a catalog component is refused, and nothing runs", async () => {
  const { run, runner } = runnerFake();
  const repository = repositoryOf(environment, [registry]);

  await expect(
    uninstallGatedRelease(repository, runner, "ghost", consent),
  ).rejects.toThrow(
    "no component named ghost in environment k3d-local; name a component from the catalog",
  );
  expect(run).not.toHaveBeenCalled();
  expect(helmReleaseStatus).not.toHaveBeenCalled();
});

test("a manifest component has no Helm release, so it is refused before any read", async () => {
  const { run, runner } = runnerFake();
  const manifest = componentOf("policy-templates", { kind: "manifest" });
  const repository = repositoryOf(environment, [manifest]);

  await expect(
    uninstallGatedRelease(repository, runner, "policy-templates", consent),
  ).rejects.toThrow(
    "policy-templates is a manifest component and has no Helm release to uninstall",
  );
  expect(helmReleaseStatus).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a release whose feature flag is on is refused, and nothing is removed", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(componentGatedOff).mockReturnValue(false);
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  const repository = repositoryOf(environment, [registry]);

  await expect(
    uninstallGatedRelease(repository, runner, "registry", consent),
  ).rejects.toThrow(
    "registry is not gated off: feature registry is on in k3d-local; kore uninstalls only the release of a turned-off feature flag",
  );
  expect(run).not.toHaveBeenCalled();
});

test("a component with no feature flag is refused as not gated off", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(componentGatedOff).mockReturnValue(false);
  const ungated = componentOf("ingress", { namespace: "ingress-ns" });
  const repository = repositoryOf(environment, [ungated]);

  await expect(
    uninstallGatedRelease(repository, runner, "ingress", consent),
  ).rejects.toThrow(
    "ingress is not gated off: it has no feature flag; kore uninstalls only the release of a turned-off feature flag",
  );
  expect(run).not.toHaveBeenCalled();
});

test("a gated-off release that is already gone is reported absent, and nothing is removed", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(helmReleaseStatus).mockRejectedValue(notFound);
  const repository = repositoryOf(environment, [registry]);

  const result = await uninstallGatedRelease(
    repository,
    runner,
    "registry",
    consent,
  );

  expect(result).toEqual({
    status: "absent",
    name: "registry",
    namespace: "registry-ns",
  });
  expect(run).not.toHaveBeenCalled();
});

test("without --yes it removes nothing and names the release and context it would uninstall", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  const repository = repositoryOf(environment, [registry]);

  await expect(
    uninstallGatedRelease(repository, runner, "registry", none),
  ).rejects.toThrow(
    "would uninstall release registry from namespace registry-ns in kube context k3d-kore-local. Nothing was removed. Repeat with --yes to uninstall it.",
  );
  expect(run).not.toHaveBeenCalled();
  expect(purgeRetainedResources).not.toHaveBeenCalled();
});

test("with --yes it uninstalls exactly the named release in the configured context and no other command", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(helmReleaseStatus)
    .mockResolvedValueOnce("deployed")
    .mockRejectedValueOnce(notFound);
  const repository = repositoryOf(environment, [registry]);

  const result = await uninstallGatedRelease(
    repository,
    runner,
    "registry",
    consent,
  );

  expect(result).toEqual({
    status: "uninstalled",
    name: "registry",
    namespace: "registry-ns",
  });
  expect(run.mock.calls.map(([command, args]) => [command, args])).toEqual([
    [
      "helm",
      [
        "uninstall",
        "registry",
        "--namespace",
        "registry-ns",
        "--kube-context",
        "k3d-kore-local",
        "--wait",
        "--timeout",
        "5m",
      ],
    ],
  ]);
});

test("a release still installed after the uninstall is reported, never as done", async () => {
  const { runner } = runnerFake();
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  const repository = repositoryOf(environment, [registry]);

  await expect(
    uninstallGatedRelease(repository, runner, "registry", consent),
  ).rejects.toThrow(
    "release registry is still installed in registry-ns after uninstall; check it with helm status registry --namespace registry-ns --kube-context k3d-kore-local",
  );
});

test("a status failure other than not-found is reported as unable to check, and nothing is removed", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(helmReleaseStatus).mockRejectedValue(
    new Error("forbidden: cannot read secrets"),
  );
  const repository = repositoryOf(environment, [registry]);

  await expect(
    uninstallGatedRelease(repository, runner, "registry", consent),
  ).rejects.toThrow(
    "kore cannot check whether release registry remains in registry-ns: forbidden: cannot read secrets",
  );
  expect(run).not.toHaveBeenCalled();
});

test("retained data in the release's namespace is refused without --purge-data, and nothing is removed", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  vi.mocked(retainedResources).mockResolvedValue(["pvc/data-registry-0"]);
  const repository = repositoryOf(environment, [registry]);

  await expect(
    uninstallGatedRelease(repository, runner, "registry", consent),
  ).rejects.toThrow(
    "release registry holds retained data in registry-ns (pvc/data-registry-0); repeat with --purge-data to delete it with the release",
  );
  expect(run).not.toHaveBeenCalled();
  expect(purgeRetainedResources).not.toHaveBeenCalled();
});

test("without --yes, the plan names the retained data it would delete and that --purge-data is needed", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  vi.mocked(retainedResources).mockResolvedValue(["pvc/data-registry-0"]);
  const repository = repositoryOf(environment, [registry]);

  await expect(
    uninstallGatedRelease(repository, runner, "registry", none),
  ).rejects.toThrow(
    "would uninstall release registry from namespace registry-ns in kube context k3d-kore-local, deleting its retained data (pvc/data-registry-0). Nothing was removed. Repeat with --yes --purge-data to uninstall it.",
  );
  expect(run).not.toHaveBeenCalled();
});

test("with --purge-data, retained data is purged in the release's own namespace before the uninstall", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(helmReleaseStatus)
    .mockResolvedValueOnce("deployed")
    .mockRejectedValueOnce(notFound);
  vi.mocked(retainedResources).mockResolvedValue(["pvc/data-registry-0"]);
  const repository = repositoryOf(environment, [registry]);

  const result = await uninstallGatedRelease(
    repository,
    runner,
    "registry",
    purge,
  );

  expect(result.status).toBe("uninstalled");
  expect(purgeRetainedResources).toHaveBeenCalledWith(
    repository,
    runner,
    "registry-ns",
  );
  expect(
    vi.mocked(purgeRetainedResources).mock.invocationCallOrder[0],
  ).toBeLessThan(run.mock.invocationCallOrder[0]!);
  expect(run.mock.calls.map(([command, args]) => [command, args[0]])).toEqual([
    ["helm", "uninstall"],
  ]);
});

test("a namespace shared with another component is refused even with --purge-data, and nothing is removed", async () => {
  const { run, runner } = runnerFake();
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  vi.mocked(retainedResources).mockResolvedValue([
    "postgresqlinstance.platform.kore.dev/db",
  ]);
  const cache = componentOf("cache", { namespace: "registry-ns" });
  const repository = repositoryOf(environment, [registry, cache]);

  await expect(
    uninstallGatedRelease(repository, runner, "registry", purge),
  ).rejects.toThrow(
    "release registry shares namespace registry-ns with cache and the namespace holds retained data (postgresqlinstance.platform.kore.dev/db); uninstall cannot tell that data from theirs, so nothing was removed",
  );
  expect(run).not.toHaveBeenCalled();
  expect(purgeRetainedResources).not.toHaveBeenCalled();
});
