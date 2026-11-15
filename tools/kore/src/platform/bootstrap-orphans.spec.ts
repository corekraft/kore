import { beforeEach, expect, test, vi } from "vitest";
import { assertExpectedCluster } from "../cluster/index.js";
import {
  enabledComponents,
  featureEnabled,
  isLocalProvider,
} from "../config/index.js";
import { ensureRegistryAuth } from "../images/index.js";
import { closeExistingAdmissionGate } from "./admission-gate.js";
import { bootstrapControllers, orphanCheckDeferred } from "./bootstrap.js";
import { assertNoOrphanedReleases } from "./gated-release.js";
import { reconcileIfNeeded } from "./reconcile.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../cluster/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../cluster/index.js")>()),
  assertExpectedCluster: vi.fn(),
  clusterUp: vi.fn(),
}));
vi.mock("../config/index.js");
vi.mock("../images/index.js");
vi.mock("./admission-gate.js");
vi.mock("./gated-release.js");
vi.mock("./portal-secrets.js");
vi.mock("./readiness-gate.js");
vi.mock("./reconcile.js");

const local = fakeRepository({ provider: "k3d" });
const gate = fakeComponent({ name: "gate", phase: "core" });
const policy = fakeComponent({ name: "policy", phase: "configuration" });

let order: string[];

beforeEach(() => {
  order = [];
  const record = (name: string) => async () => void order.push(name);
  vi.mocked(assertExpectedCluster).mockImplementation(record("cluster"));
  vi.mocked(closeExistingAdmissionGate).mockImplementation(
    record("close-gate"),
  );
  vi.mocked(assertNoOrphanedReleases).mockImplementation(record("orphans"));
  vi.mocked(reconcileIfNeeded).mockImplementation(async (_repo, _runner, c) => {
    order.push(`reconcile:${c.name}`);
  });
  vi.mocked(isLocalProvider).mockReturnValue(false);
  vi.mocked(featureEnabled).mockReturnValue(false);
  vi.mocked(enabledComponents).mockReturnValue([gate, policy]);
});

test("with the rollback-order flag on, an orphaned release is reported after the components, not before them", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(assertNoOrphanedReleases).mockImplementation(async () => {
    order.push("orphans");
    throw new Error("helm uninstall agentgateway");
  });
  await expect(
    bootstrapControllers(local, fakeRunner().runner),
  ).rejects.toThrow("helm uninstall agentgateway");
  expect(order).toEqual(["cluster", "close-gate", "reconcile:gate", "orphans"]);
});

test("with the rollback-order flag off, an orphaned release stops bootstrap before any component runs", async () => {
  vi.mocked(assertNoOrphanedReleases).mockRejectedValueOnce(
    new Error("helm uninstall agentgateway"),
  );
  await expect(
    bootstrapControllers(local, fakeRunner().runner),
  ).rejects.toThrow("helm uninstall agentgateway");
  expect(reconcileIfNeeded).not.toHaveBeenCalled();
  expect(ensureRegistryAuth).not.toHaveBeenCalled();
});

test("a caller that runs the deferred check itself is not checked twice by bootstrap", async () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  await bootstrapControllers(local, fakeRunner().runner, {
    orphanCheck: "caller",
  });
  expect(assertNoOrphanedReleases).not.toHaveBeenCalled();
});

test("the orphan check is deferred exactly when gateway-rollback-order is on, and not by the class-change flag", () => {
  vi.mocked(featureEnabled).mockImplementation(
    (_environment, flag) => flag === "gateway-class-change-release",
  );
  expect(orphanCheckDeferred(local)).toBe(false);
  vi.mocked(featureEnabled).mockImplementation(
    (_environment, flag) => flag === "gateway-rollback-order",
  );
  expect(orphanCheckDeferred(local)).toBe(true);
});
