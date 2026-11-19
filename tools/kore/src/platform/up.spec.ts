import { beforeEach, expect, test, vi } from "vitest";
import { isLocalProvider } from "../config/index.js";
import { installLocalTrust } from "../security/index.js";
import {
  bootstrapControllers,
  openApplicationAdmission,
  orphanCheckDeferred,
} from "./bootstrap.js";
import { assertNoOrphanedReleases } from "./gated-release.js";
import { awaitArgocdDelivery, reconcileConfigurations } from "./handover.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import type { ReadinessEvidence } from "./readiness-manifest.js";
import { platformUp } from "./up.js";
import { writePlatformState } from "./platform-state.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

vi.mock("../config/index.js");
vi.mock("../security/index.js");
vi.mock("./bootstrap.js");
vi.mock("./handover.js");
vi.mock("./enrollment.js");
vi.mock("./gated-release.js");
vi.mock("./platform-state.js");

const local = fakeRepository({ provider: "k3d" });
const managed = fakeRepository({ provider: "managed" });
const openEvidence: ReadinessEvidence = {
  manifestVersion: 1,
  environment: "local",
  context: "k3d-kore-local",
  generation: "g",
  state: "open",
  evaluatedAt: "2026-11-14T08:00:00.000Z",
  requirements: [],
  failures: [],
};

/** Every collaborator records its step, so a test can assert the whole order. */
let order: string[];

beforeEach(() => {
  order = [];
  const record = (name: string) => async () => void order.push(name);
  vi.mocked(bootstrapControllers).mockImplementation(record("bootstrap"));
  vi.mocked(installLocalTrust).mockImplementation(record("trust"));
  vi.mocked(reconcileConfigurations).mockImplementation(record("configure"));
  vi.mocked(awaitArgocdDelivery).mockImplementation(record("delivery"));
  vi.mocked(enrollPlatformNamespaces).mockImplementation(record("enroll"));
  vi.mocked(openApplicationAdmission).mockImplementation(async () => {
    order.push("open-gate");
    return openEvidence;
  });
  vi.mocked(writePlatformState).mockImplementation(async (_repo, status) => {
    order.push(`state:${status}`);
  });
  vi.mocked(isLocalProvider).mockImplementation(
    (environment) => environment.provider === "k3d",
  );
});

test("platform up bootstraps the controllers before anything else", async () => {
  await platformUp(local, fakeRunner().runner);
  expect(order[0]).toBe("bootstrap");
});

test("a local environment installs local trust once its controllers are bootstrapped", async () => {
  await platformUp(local, fakeRunner().runner);
  expect(order.indexOf("trust")).toBe(1);
});

test("a managed environment never installs local trust", async () => {
  await platformUp(managed, fakeRunner().runner);
  expect(installLocalTrust).not.toHaveBeenCalled();
});

test("the configuration is reconciled after trust, then the Argo CD delivery is awaited, then enrollment, the gate and the state", async () => {
  await platformUp(local, fakeRunner().runner);
  expect(order).toEqual([
    "bootstrap",
    "trust",
    "configure",
    "delivery",
    "enroll",
    "open-gate",
    "state:ready",
  ]);
});

test("the configuration and the Argo CD delivery are each given the repository and runner of this run", async () => {
  const { runner } = fakeRunner();
  await platformUp(local, runner);
  expect(reconcileConfigurations).toHaveBeenCalledWith(local, runner);
  expect(awaitArgocdDelivery).toHaveBeenCalledWith(local, runner);
});

test("enrollment runs after the delivery wait, and before the gate opens", async () => {
  const { runner } = fakeRunner();
  await platformUp(local, runner);
  expect(order.slice(-3)).toEqual(["enroll", "open-gate", "state:ready"]);
  expect(enrollPlatformNamespaces).toHaveBeenCalledWith(local, runner);
});

test("the platform state is written as ready last, after the gate opens", async () => {
  await platformUp(local, fakeRunner().runner);
  expect(writePlatformState).toHaveBeenCalledWith(local, "ready");
  expect(order.at(-1)).toBe("state:ready");
});

test("a configuration failure stops up before the delivery wait, enrollment, the gate and the state", async () => {
  vi.mocked(reconcileConfigurations).mockRejectedValueOnce(
    new Error("policy crashed"),
  );
  await expect(platformUp(local, fakeRunner().runner)).rejects.toThrow(
    "policy crashed",
  );
  expect(awaitArgocdDelivery).not.toHaveBeenCalled();
  expect(enrollPlatformNamespaces).not.toHaveBeenCalled();
  expect(openApplicationAdmission).not.toHaveBeenCalled();
  expect(writePlatformState).not.toHaveBeenCalled();
});

test("a failed bootstrap stops up before any configuration is reconciled", async () => {
  vi.mocked(bootstrapControllers).mockRejectedValueOnce(
    new Error("cluster down"),
  );
  await expect(platformUp(local, fakeRunner().runner)).rejects.toThrow(
    "cluster down",
  );
  expect(reconcileConfigurations).not.toHaveBeenCalled();
  expect(installLocalTrust).not.toHaveBeenCalled();
});

test("a delivery wait that fails stops up before enrollment, the gate and the state, so the gate stays closed", async () => {
  vi.mocked(awaitArgocdDelivery).mockRejectedValueOnce(
    new Error(
      "Application golden-path-example is Synced and Progressing; run kubectl --context k3d-kore-local -n argocd describe application golden-path-example",
    ),
  );
  await expect(platformUp(local, fakeRunner().runner)).rejects.toThrow(
    "Application golden-path-example is Synced and Progressing",
  );
  expect(enrollPlatformNamespaces).not.toHaveBeenCalled();
  expect(openApplicationAdmission).not.toHaveBeenCalled();
  expect(writePlatformState).not.toHaveBeenCalled();
});

test("up hands the orphan check to itself and runs it after the configuration, before the delivery wait, when the check is deferred", async () => {
  vi.mocked(orphanCheckDeferred).mockReturnValue(true);
  vi.mocked(assertNoOrphanedReleases).mockImplementation(async () => {
    order.push("orphans");
  });
  await platformUp(local, fakeRunner().runner);
  expect(bootstrapControllers).toHaveBeenCalledWith(local, expect.anything(), {
    orphanCheck: "caller",
  });
  expect(order).toEqual([
    "bootstrap",
    "trust",
    "configure",
    "orphans",
    "delivery",
    "enroll",
    "open-gate",
    "state:ready",
  ]);
});

test("a deferred orphan refusal fails up after configuring, and leaves the gate closed and the state unwritten", async () => {
  vi.mocked(orphanCheckDeferred).mockReturnValue(true);
  vi.mocked(assertNoOrphanedReleases).mockRejectedValueOnce(
    new Error("helm uninstall agentgateway"),
  );
  await expect(platformUp(local, fakeRunner().runner)).rejects.toThrow(
    "helm uninstall agentgateway",
  );
  expect(order).toContain("configure");
  expect(openApplicationAdmission).not.toHaveBeenCalled();
  expect(writePlatformState).not.toHaveBeenCalled();
});

test("up does not run its own orphan check when bootstrap already did it up front", async () => {
  vi.mocked(orphanCheckDeferred).mockReturnValue(false);
  await platformUp(local, fakeRunner().runner);
  expect(assertNoOrphanedReleases).not.toHaveBeenCalled();
});
