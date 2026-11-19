// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { enabledComponents, releaseOwner } from "../config/index.js";
import type { Repository } from "../config/index.js";
import { errorMessage } from "./probe.js";
import { awaitArgocdDelivery } from "./handover.js";
import { waitForApplications } from "./readiness-argocd.js";
import { readinessFailure } from "./readiness.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../config/index.js");
vi.mock("./probe.js");
vi.mock("./reconcile.js");
vi.mock("./readiness.js");
vi.mock("./readiness-argocd.js");

const delivery = fakeComponent({
  name: "kore-config-delivery",
  phase: "configuration",
  namespace: "argocd",
  timeout: "5m",
});
const platformConfig = fakeComponent({
  name: "kore-platform-config",
  phase: "configuration",
  namespace: "kore-system",
  timeout: "3s",
  owner: "argocd",
});
const opa = fakeComponent({
  name: "opa-authorizer",
  phase: "configuration",
  namespace: "opa-system",
  timeout: "3s",
  owner: "argocd",
});

const repository: Repository = fakeRepository({
  provider: "k3d",
  kubeContext: "k3d-kore-local",
});

/** The flag is on: the two handed-over releases are Argo CD owned, the delivery release is kore owned. */
function flagOn(): void {
  vi.mocked(enabledComponents).mockReturnValue([delivery, opa, platformConfig]);
  vi.mocked(releaseOwner).mockImplementation((_environment, component) =>
    component.owner === "argocd" ? "argocd" : "kore",
  );
}

/** The flag is off: nothing is Argo CD owned, whatever the catalog says. */
function flagOff(): void {
  vi.mocked(enabledComponents).mockReturnValue([delivery, opa, platformConfig]);
  vi.mocked(releaseOwner).mockReturnValue("kore");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
  vi.mocked(readinessFailure).mockResolvedValue(undefined);
  vi.mocked(waitForApplications).mockResolvedValue(undefined);
  flagOn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

test("with no release owned by Argo CD, nothing is probed and no Application is read", async () => {
  flagOff();
  const { runner } = fakeRunner();

  await awaitArgocdDelivery(repository, runner);

  expect(readinessFailure).not.toHaveBeenCalled();
  expect(waitForApplications).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test("the Applications that kore-config-delivery created are awaited within its own timeout, read from its namespace", async () => {
  const { runner } = fakeRunner();

  await awaitArgocdDelivery(repository, runner);

  expect(waitForApplications).toHaveBeenCalledWith(
    {
      repository,
      runner,
      base: ["--context", "k3d-kore-local", "--namespace", "argocd"],
    },
    "5m",
  );
});

test("the Applications are awaited before any Argo CD owned release is probed", async () => {
  const { runner } = fakeRunner();

  await awaitArgocdDelivery(repository, runner);

  const applications =
    vi.mocked(waitForApplications).mock.invocationCallOrder[0];
  const probed = vi.mocked(readinessFailure).mock.invocationCallOrder[0];
  expect(applications).toBeLessThan(probed!);
});

test("each Argo CD owned release is probed with the same repository and runner, and a kore-owned release is never probed here", async () => {
  const { runner } = fakeRunner();

  await awaitArgocdDelivery(repository, runner);

  expect(readinessFailure).toHaveBeenCalledTimes(2);
  expect(readinessFailure).toHaveBeenCalledWith(repository, runner, opa);
  expect(readinessFailure).toHaveBeenCalledWith(
    repository,
    runner,
    platformConfig,
  );
  expect(readinessFailure).not.toHaveBeenCalledWith(
    repository,
    runner,
    delivery,
  );
});

test("a release that is not ready yet is probed again every 250 ms until it is ready, on the fake clock", async () => {
  vi.mocked(readinessFailure)
    .mockResolvedValueOnce("deployment/opa-authorizer not found")
    .mockResolvedValueOnce("deployment/opa-authorizer not ready")
    .mockResolvedValueOnce(undefined);
  const { runner } = fakeRunner();
  const done = awaitArgocdDelivery(repository, runner);

  const probesOf = () =>
    vi
      .mocked(readinessFailure)
      .mock.calls.filter(([, , component]) => component === opa).length;

  await vi.advanceTimersByTimeAsync(249);
  expect(probesOf()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync(250);
  await done;

  expect(probesOf()).toBe(3);
});

test("a release that never becomes ready fails at its own timeout, naming the release and its last state", async () => {
  vi.mocked(readinessFailure).mockResolvedValue(
    "deployment/opa-authorizer not ready (rollout complete and a replica available) within 3s: deployment/opa-authorizer has no available replicas",
  );
  const { runner } = fakeRunner();
  const outcome = expect(
    awaitArgocdDelivery(repository, runner),
  ).rejects.toThrow(
    "argocd-owned release opa-authorizer is not ready after 3s: deployment/opa-authorizer not ready (rollout complete and a replica available) within 3s: deployment/opa-authorizer has no available replicas",
  );

  // opa-authorizer's 3s bound is probed 13 times, then the wait stops; the
  // handed-over platform config is never reached because the first one failed.
  await vi.advanceTimersByTimeAsync(3000);
  await outcome;

  expect(readinessFailure).toHaveBeenCalledTimes(13);
  expect(readinessFailure).not.toHaveBeenCalledWith(
    repository,
    runner,
    platformConfig,
  );
});

test("Argo CD owned releases with no enabled kore-config-delivery fail naming it, since no Application can be read", async () => {
  vi.mocked(enabledComponents).mockReturnValue([opa, platformConfig]);
  const { runner } = fakeRunner();

  await expect(awaitArgocdDelivery(repository, runner)).rejects.toThrow(
    "kore-config-delivery is not enabled, so the Applications that Argo CD owns cannot be awaited",
  );

  expect(waitForApplications).not.toHaveBeenCalled();
  expect(readinessFailure).not.toHaveBeenCalled();
});

test("an Application that is not Synced and Healthy fails the wait with its name, before any release is probed", async () => {
  vi.mocked(waitForApplications).mockRejectedValue(
    new Error(
      "Application golden-path-example is Synced and Progressing; run kubectl --context k3d-kore-local -n argocd describe application golden-path-example",
    ),
  );
  const { runner } = fakeRunner();

  await expect(awaitArgocdDelivery(repository, runner)).rejects.toThrow(
    "Application golden-path-example is Synced and Progressing",
  );

  expect(readinessFailure).not.toHaveBeenCalled();
});
