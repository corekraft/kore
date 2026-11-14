// Docs: docs/decisions/0063-lifecycle-resume-and-release-only-app-up.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  activateNamespace,
  bindCrossplaneSecrets,
  enrollNamespace,
  installResources,
  installWorkload,
  resolveCharts,
} from "./install.js";
import { cleanupInterruptedReleases } from "./cleanup.js";
import {
  assertAppAdmissible,
  waitForResources,
  waitForRollouts,
  waitForRoutes,
  waitForSecretSource,
} from "./readiness.js";
import { verifyImage } from "./verify.js";
import { converge } from "./converge.js";
import { fakeImage, fakeRepository, fakeRunner } from "./app-support.js";

vi.mock("./install.js");
vi.mock("./cleanup.js");
vi.mock("./readiness.js");
vi.mock("./verify.js");

const name = "reference";
const repository = fakeRepository();
const charts = { resources: "/charts/resources", workload: "/charts/workload" };
const image = fakeImage();

beforeEach(() => {
  vi.mocked(assertAppAdmissible).mockResolvedValue("g-abc");
  vi.mocked(resolveCharts).mockResolvedValue(charts);
  vi.mocked(waitForSecretSource).mockResolvedValue("");
});

/** The call order in which a collaborator was first called. */
const first = (fn: (...args: never[]) => unknown): number =>
  vi.mocked(fn).mock.invocationCallOrder[0] ?? Number.NaN;

test("converge runs the whole sequence in order: admission, verification, charts, enrollment, activation, Crossplane, cleanup, resources, the Secret, workload, rollouts, routes", async () => {
  const { runner } = fakeRunner();
  await converge(repository, runner, name, image, {});
  const steps = [
    assertAppAdmissible,
    verifyImage,
    resolveCharts,
    enrollNamespace,
    activateNamespace,
    bindCrossplaneSecrets,
    cleanupInterruptedReleases,
    installResources,
    waitForResources,
    waitForSecretSource,
    installWorkload,
    waitForRollouts,
    waitForRoutes,
  ];
  const at = steps.map(first);
  expect(at.every(Number.isFinite)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
});

test("converge installs nothing and touches no namespace when admission is closed", async () => {
  vi.mocked(assertAppAdmissible).mockRejectedValue(new Error("gate closed"));
  const { runner } = fakeRunner();
  await expect(converge(repository, runner, name, image, {})).rejects.toThrow(
    "gate closed",
  );
  expect(verifyImage).not.toHaveBeenCalled();
  expect(enrollNamespace).not.toHaveBeenCalled();
  expect(installResources).not.toHaveBeenCalled();
  expect(installWorkload).not.toHaveBeenCalled();
});

test("converge verifies the image before any cluster change, and installs nothing when verification fails", async () => {
  vi.mocked(verifyImage).mockRejectedValue(new Error("cosign failed"));
  const { runner } = fakeRunner();
  await expect(converge(repository, runner, name, image, {})).rejects.toThrow(
    "cosign failed",
  );
  expect(enrollNamespace).not.toHaveBeenCalled();
  expect(cleanupInterruptedReleases).not.toHaveBeenCalled();
  expect(installResources).not.toHaveBeenCalled();
});

test("converge verifies against the given public key, and against the image's own signer when none is given", async () => {
  const { runner } = fakeRunner();
  await converge(repository, runner, name, image, { publicKey: "/k.pub" });
  await converge(repository, runner, name, image, {});
  expect(vi.mocked(verifyImage).mock.calls).toEqual([
    [repository, runner, image, "/k.pub"],
    [repository, runner, image, undefined],
  ]);
});

test("converge activates the namespace under the generation admission returned, not any other", async () => {
  vi.mocked(assertAppAdmissible).mockResolvedValue("g-xyz");
  const { runner } = fakeRunner();
  await converge(repository, runner, name, image, {});
  expect(activateNamespace).toHaveBeenCalledWith(
    repository,
    runner,
    name,
    "g-xyz",
  );
});

test("converge clears interrupted releases before it installs the resources release", async () => {
  const { runner } = fakeRunner();
  await converge(repository, runner, name, image, {});
  expect(first(cleanupInterruptedReleases)).toBeLessThan(
    first(installResources),
  );
});

test("the workload is installed with the secret version only when the source has one", async () => {
  vi.mocked(waitForSecretSource).mockResolvedValue("v1");
  const { runner } = fakeRunner();
  await converge(repository, runner, name, image, {});
  expect(installWorkload).toHaveBeenLastCalledWith(
    repository,
    runner,
    name,
    charts,
    {
      image,
      secretVersion: "v1",
    },
  );

  vi.mocked(installWorkload).mockClear();
  vi.mocked(waitForSecretSource).mockResolvedValue("");
  await converge(repository, runner, name, image, {});
  expect(installWorkload).toHaveBeenLastCalledWith(
    repository,
    runner,
    name,
    charts,
    { image },
  );
});

test("the workload waits on the Secret before it installs, and the rollouts wait after it", async () => {
  const { runner } = fakeRunner();
  await converge(repository, runner, name, image, {});
  expect(first(waitForSecretSource)).toBeLessThan(first(installWorkload));
  expect(first(installWorkload)).toBeLessThan(first(waitForRollouts));
});

test("rollouts are awaited whatever the installs changed, and routes wait only after them", async () => {
  const { runner } = fakeRunner();
  await converge(repository, runner, name, image, {});
  expect(waitForRollouts).toHaveBeenCalledWith(repository, runner, name);
  expect(first(waitForRollouts)).toBeLessThan(first(waitForRoutes));
});

test("the route wait takes the caller's timeout, and the default when none is given", async () => {
  const { runner } = fakeRunner();
  await converge(repository, runner, name, image, { routeTimeout: "1m" });
  await converge(repository, runner, name, image, {});
  expect(vi.mocked(waitForRoutes).mock.calls.map((call) => call[3])).toEqual([
    "1m",
    undefined,
  ]);
});
