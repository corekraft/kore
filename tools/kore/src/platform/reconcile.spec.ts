import { beforeEach, expect, test, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import { FailFastError, withFailFast } from "./fail-fast.js";
import { desiredFingerprint } from "./fingerprint.js";
import {
  assertChartDelivery,
  assertGoldenPathDelivery,
  envOption,
  helmEnv,
  helmUpgradeArgs,
  manifestSource,
  patchFailure,
  withAbsoluteChart,
} from "./helm.js";
import {
  assertOwnedCrdsExist,
  errorMessage,
  helmReleaseStatus,
} from "./probe.js";
import { waitFor } from "./readiness.js";
import {
  reconcileComponent,
  reconcileConfiguration,
  reconcileIfNeeded,
  recoverUndeployedRelease,
  releaseMatchesFingerprint,
} from "./reconcile.js";
import { recoverRelease } from "./release-recovery.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("./fail-fast.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fail-fast.js")>()),
  withFailFast: vi.fn(),
}));
vi.mock("./fingerprint.js");
vi.mock("./helm.js");
vi.mock("./probe.js");
vi.mock("./readiness.js");
vi.mock("./release-recovery.js");

const repository = fakeRepository();
const chart = fakeComponent();
const manifest = fakeComponent({
  name: "crds",
  kind: "manifest",
  ownsCRDs: ["crontabs.example.com"],
});
const deployed = (description: string) =>
  JSON.stringify([{ revision: 1, status: "deployed", description }]);
const notFound = () =>
  new CommandError("helm", [], {
    stdout: "",
    stderr: "Error: release: not found",
    code: 1,
  });
const commandFailure = () =>
  new CommandError("helm", [], { stdout: "", stderr: "boom", code: 1 });

beforeEach(() => {
  vi.mocked(withFailFast).mockImplementation((_repo, runner, _c, run) =>
    run(runner),
  );
  vi.mocked(desiredFingerprint).mockReturnValue("fp-desired");
  vi.mocked(helmUpgradeArgs).mockImplementation((_repo, c) => [
    "upgrade",
    c.name,
  ]);
  vi.mocked(helmEnv).mockReturnValue(undefined);
  vi.mocked(envOption).mockReturnValue({});
  vi.mocked(withAbsoluteChart).mockImplementation((_repo, _c, args) => args);
  vi.mocked(manifestSource).mockReturnValue("manifests/crds");
  vi.mocked(patchFailure).mockResolvedValue(undefined);
  vi.mocked(recoverRelease).mockResolvedValue("none");
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  vi.mocked(assertOwnedCrdsExist).mockResolvedValue();
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
  vi.mocked(waitFor).mockResolvedValue();
});

test.each(["uninstalled", "rolled-back"] as const)(
  "a %s release counts as recovered",
  async (recovery) => {
    vi.mocked(recoverRelease).mockResolvedValue(recovery);
    await expect(
      recoverUndeployedRelease(repository, fakeRunner().runner, chart),
    ).resolves.toBe(true);
  },
);

test("a release with nothing to clear reports that nothing changed", async () => {
  await expect(
    recoverUndeployedRelease(repository, fakeRunner().runner, chart),
  ).resolves.toBe(false);
});

test("a chart that cannot be delivered is refused before Helm runs, so no cluster call is made", async () => {
  vi.mocked(assertChartDelivery).mockImplementation(() => {
    throw new Error("needs the chart lock");
  });
  const { runner, run } = fakeRunner();
  await expect(reconcileComponent(repository, runner, chart)).rejects.toThrow(
    "needs the chart lock",
  );
  expect(assertChartDelivery).toHaveBeenCalledWith(repository, chart);
  expect(run).not.toHaveBeenCalled();
});

test("a golden-path release without its template lock is refused before Helm runs", async () => {
  vi.mocked(assertGoldenPathDelivery).mockImplementation(() => {
    throw new Error("needs the template lock");
  });
  const { runner, run } = fakeRunner();
  await expect(reconcileComponent(repository, runner, chart)).rejects.toThrow(
    "needs the template lock",
  );
  expect(assertGoldenPathDelivery).toHaveBeenCalledWith(repository, chart);
  expect(run).not.toHaveBeenCalled();
});

test("a manifest component is applied recursively with server-side apply, then waited on", async () => {
  const { runner, run } = fakeRunner();
  await reconcileComponent(repository, runner, manifest);
  expect(run.mock.calls).toEqual([
    [
      "kubectl",
      [
        "--context",
        "k3d-kore-local",
        "apply",
        "--server-side",
        "--field-manager=kore",
        "--recursive",
        "--filename",
        "manifests/crds",
      ],
      { capture: false },
    ],
  ]);
  expect(waitFor).toHaveBeenCalledWith(repository, runner, manifest);
});

test("a Helm component is upgraded with its fingerprint as the release description, from the repository root", async () => {
  const { runner, run } = fakeRunner();
  await reconcileComponent(repository, runner, chart);
  expect(run).toHaveBeenNthCalledWith(
    1,
    "helm",
    ["upgrade", "reference", "--description", "fp-desired"],
    { capture: false, cwd: "/repo" },
  );
  expect(waitFor).toHaveBeenCalledWith(repository, runner, chart);
});

test("an upgrade that a never-deployed release blocked is recovered and retried once", async () => {
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(commandFailure());
  vi.mocked(recoverRelease).mockResolvedValue("uninstalled");
  await reconcileComponent(repository, runner, chart);
  expect(run.mock.calls.map(([command, args]) => [command, args[0]])).toEqual([
    ["helm", "upgrade"],
    ["helm", "upgrade"],
  ]);
});

test("an upgrade that fails with something other than a command error is not recovered", async () => {
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(new Error("disk full"));
  await expect(reconcileComponent(repository, runner, chart)).rejects.toThrow(
    "component reference failed to become ready: disk full",
  );
  expect(recoverRelease).not.toHaveBeenCalled();
});

test("an upgrade a patch caused reports the patch error Helm hides", async () => {
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(commandFailure());
  vi.mocked(patchFailure).mockResolvedValue(
    "patch target Deployment/reference is missing",
  );
  await expect(reconcileComponent(repository, runner, chart)).rejects.toThrow(
    'component reference failed to become ready: patch target Deployment/reference is missing; helm hid it as "plugin exited with error"',
  );
});

test("an upgrade failure no patch caused is rethrown as the component's failure", async () => {
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(commandFailure());
  await expect(reconcileComponent(repository, runner, chart)).rejects.toThrow(
    "component reference failed to become ready",
  );
  expect(patchFailure).toHaveBeenCalledWith(repository, runner, chart);
});

test("a readiness failure is wrapped with the component's name", async () => {
  vi.mocked(waitFor).mockRejectedValue(new Error("pod pending"));
  await expect(
    reconcileComponent(repository, fakeRunner().runner, chart),
  ).rejects.toThrow("component reference failed to become ready: pod pending");
});

test("a fail-fast stop is rethrown as it was, not wrapped", async () => {
  vi.mocked(withFailFast).mockRejectedValueOnce(new FailFastError("node lost"));
  const error = await reconcileComponent(
    repository,
    fakeRunner().runner,
    chart,
  ).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(FailFastError);
  expect((error as Error).message).toBe("node lost");
});

test("a release whose latest deployed revision carries the fingerprint matches it", async () => {
  const history = JSON.stringify([
    { revision: 1, status: "superseded", description: "old" },
    { revision: 2, status: "deployed", description: "fp" },
    { revision: 3, status: "failed", description: "x" },
  ]);
  const { runner } = fakeRunner(() => history);
  await expect(
    releaseMatchesFingerprint(
      repository,
      runner,
      { name: "reference", namespace: "reference" },
      "fp",
    ),
  ).resolves.toBe(true);
});

test("a release deployed from other content, or with no deployed revision, is drift", async () => {
  const release = { name: "reference", namespace: "reference" };
  const other = fakeRunner(() => deployed("other"));
  await expect(
    releaseMatchesFingerprint(repository, other.runner, release, "fp"),
  ).resolves.toBe(false);
  const failedOnly = fakeRunner(() =>
    JSON.stringify([{ revision: 1, status: "failed", description: "fp" }]),
  );
  await expect(
    releaseMatchesFingerprint(repository, failedOnly.runner, release, "fp"),
  ).resolves.toBe(false);
});

test("a release the cluster does not have is drift, not an error", async () => {
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(notFound());
  await expect(
    releaseMatchesFingerprint(
      repository,
      runner,
      { name: "reference", namespace: "reference" },
      "fp",
    ),
  ).resolves.toBe(false);
});

test("any other history failure is rethrown naming the release and the context to check", async () => {
  const { runner, run } = fakeRunner();
  run.mockRejectedValueOnce(commandFailure());
  await expect(
    releaseMatchesFingerprint(
      repository,
      runner,
      { name: "reference", namespace: "reference" },
      "fp",
    ),
  ).rejects.toThrow(
    /cannot read the deployed state of release reference in reference \(k3d-kore-local\) to check for drift/,
  );
});

test("an installed Helm release deployed from the same desired state is only waited on, never upgraded", async () => {
  const { runner, run } = fakeRunner(() => deployed("fp-desired"));
  await reconcileIfNeeded(repository, runner, chart);
  expect(run.mock.calls.map(([, args]) => args[0])).toEqual(["history"]);
  expect(waitFor).toHaveBeenCalledWith(repository, runner, chart);
});

test("a Helm release whose status cannot be read is reconciled, not left alone", async () => {
  vi.mocked(helmReleaseStatus).mockRejectedValue(new Error("no cluster"));
  const { runner, run } = fakeRunner();
  await reconcileIfNeeded(repository, runner, chart);
  expect(run.mock.calls.map(([, args]) => args[0])).toEqual(["upgrade"]);
});

test("an installed manifest whose CRDs exist is waited on without applying it again", async () => {
  const { runner, run } = fakeRunner();
  await reconcileIfNeeded(repository, runner, manifest);
  expect(run).not.toHaveBeenCalled();
  expect(waitFor).toHaveBeenCalledWith(repository, runner, manifest);
});

test("a manifest whose CRDs are absent is applied", async () => {
  vi.mocked(assertOwnedCrdsExist).mockRejectedValue(new Error("not found"));
  const { runner, run } = fakeRunner();
  await reconcileIfNeeded(repository, runner, manifest);
  expect(run.mock.calls[0]![0]).toBe("kubectl");
});

test("a configuration manifest is applied on every run, even when its CRDs exist", async () => {
  const { runner, run } = fakeRunner();
  await reconcileConfiguration(repository, runner, manifest);
  expect(run.mock.calls[0]![0]).toBe("kubectl");
});

test("a configuration Helm release deployed from the desired state is not upgraded", async () => {
  const { runner, run } = fakeRunner(() => deployed("fp-desired"));
  await reconcileConfiguration(repository, runner, chart);
  expect(run.mock.calls.map(([, args]) => args[0])).toEqual(["history"]);
});
