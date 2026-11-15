import { beforeEach, expect, test, vi } from "vitest";
import { helmInstalledComponents, isLocalProvider } from "../config/index.js";
import { installLocalTrust } from "../security/index.js";
import { bootstrapControllers, openApplicationAdmission } from "./bootstrap.js";
import {
  composeChartDelivery,
  prepareChartDelivery,
} from "./chart-delivery.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import type { ReadinessEvidence } from "./readiness-manifest.js";
import { platformUp } from "./up.js";
import { writePlatformState } from "./platform-state.js";
import { reconcileConfiguration } from "./reconcile.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../config/index.js");
vi.mock("../security/index.js");
vi.mock("./bootstrap.js");
vi.mock("./chart-delivery.js");
vi.mock("./enrollment.js");
vi.mock("./platform-state.js");
vi.mock("./reconcile.js");

const local = fakeRepository({ provider: "k3d" });
const managed = fakeRepository({ provider: "managed" });
const core = fakeComponent({ name: "gate", phase: "core" });
const policy = fakeComponent({ name: "policy", phase: "configuration" });
const enforce = fakeComponent({ name: "enforce", phase: "enforcement" });
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
  vi.mocked(reconcileConfiguration).mockImplementation(
    async (_repo, _runner, c) => {
      order.push(`configure:${c.name}`);
    },
  );
  vi.mocked(composeChartDelivery).mockImplementation(async (repository) => {
    order.push("compose");
    return repository;
  });
  vi.mocked(prepareChartDelivery).mockImplementation(async (_r, _n, c) => {
    order.push(`prepare:${c.name}`);
  });
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
  vi.mocked(helmInstalledComponents).mockReturnValue([core, policy, enforce]);
});

test("platform up validates and composes the delivery values before it touches the cluster", async () => {
  await platformUp(local, fakeRunner().runner, { platformChartLock: "l.json" });
  expect(order.slice(0, 2)).toEqual(["compose", "bootstrap"]);
  expect(composeChartDelivery).toHaveBeenCalledWith(local, "l.json");
});

test("a lock that fails validation stops up before bootstrap", async () => {
  vi.mocked(composeChartDelivery).mockRejectedValueOnce(
    new Error("platform chart lock: no entry for release opa-authorizer"),
  );
  await expect(platformUp(local, fakeRunner().runner)).rejects.toThrow(
    "no entry for release opa-authorizer",
  );
  expect(bootstrapControllers).not.toHaveBeenCalled();
});

test("each configuration release is prepared for delivery just before it is installed", async () => {
  const { runner } = fakeRunner();
  await platformUp(local, runner);
  const steps = order.filter(
    (step) => step.startsWith("prepare:") || step.startsWith("configure:"),
  );
  expect(steps).toEqual([
    "prepare:policy",
    "configure:policy",
    "prepare:enforce",
    "configure:enforce",
  ]);
  expect(prepareChartDelivery).toHaveBeenCalledWith(local, runner, policy);
});

test("a local environment installs local trust once its controllers are bootstrapped", async () => {
  await platformUp(local, fakeRunner().runner);
  expect(order.indexOf("trust")).toBe(order.indexOf("bootstrap") + 1);
});

test("a managed environment never installs local trust", async () => {
  await platformUp(managed, fakeRunner().runner);
  expect(installLocalTrust).not.toHaveBeenCalled();
});

test("only configuration and enforcement components are reconciled by up", async () => {
  await platformUp(local, fakeRunner().runner);
  expect(order.filter((step) => step.startsWith("configure:"))).toEqual([
    "configure:policy",
    "configure:enforce",
  ]);
});

test("enrollment runs after every configuration phase, and before the gate opens", async () => {
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

test("a configuration component that fails stops up before enrollment, the gate and the state", async () => {
  vi.mocked(reconcileConfiguration).mockRejectedValueOnce(
    new Error("policy crashed"),
  );
  await expect(platformUp(local, fakeRunner().runner)).rejects.toThrow(
    "policy crashed",
  );
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
  expect(reconcileConfiguration).not.toHaveBeenCalled();
  expect(installLocalTrust).not.toHaveBeenCalled();
});
