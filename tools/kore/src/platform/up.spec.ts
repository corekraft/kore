import { beforeEach, expect, test, vi } from "vitest";
import { helmInstalledComponents, isLocalProvider } from "../config/index.js";
import { installLocalTrust } from "../security/index.js";
import { bootstrapControllers, openApplicationAdmission } from "./bootstrap.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import { CommandError } from "../runtime/index.js";
import type { ReadinessEvidence } from "./readiness-manifest.js";
import { platformUp } from "./up.js";
import { helmReleaseStatus } from "./probe.js";
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
vi.mock("./enrollment.js");
vi.mock("./platform-state.js");
vi.mock("./probe.js");
vi.mock("./reconcile.js");

const local = fakeRepository({ provider: "k3d" });
const managed = fakeRepository({ provider: "managed" });
const core = fakeComponent({ name: "gate", phase: "core" });
const policy = fakeComponent({ name: "policy", phase: "configuration" });
const handed = fakeComponent({
  name: "tls",
  phase: "configuration",
  owner: "argocd",
});
const delivery = fakeComponent({
  name: "kore-config-delivery",
  phase: "configuration",
});
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
  vi.mocked(helmReleaseStatus).mockResolvedValue(undefined);
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

/** The flag is on: Helm lists the argocd release until the delivery release is installed. */
function flagOn(): void {
  vi.mocked(helmInstalledComponents).mockImplementation(
    (_repository, deliveryInstalled) =>
      deliveryInstalled
        ? [core, policy, delivery]
        : [core, handed, delivery, policy],
  );
}

test("an argocd release is still reconciled by Helm while kore-config-delivery is not installed, so a failed delivery leaves Helm managing it", async () => {
  flagOn();
  vi.mocked(helmReleaseStatus).mockResolvedValue("failed");
  await platformUp(local, fakeRunner().runner);
  expect(order.filter((step) => step.startsWith("configure:"))).toEqual([
    "configure:tls",
    "configure:kore-config-delivery",
    "configure:policy",
  ]);
});

test("an argocd release is not reconciled by Helm once kore-config-delivery is deployed, and the delivery release still is", async () => {
  flagOn();
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  const { runner } = fakeRunner();
  await platformUp(local, runner);
  expect(order.filter((step) => step.startsWith("configure:"))).toEqual([
    "configure:kore-config-delivery",
    "configure:policy",
  ]);
  expect(helmReleaseStatus).toHaveBeenCalledWith(local, runner, delivery);
});

test("with the flag off up never asks the cluster whether the delivery release is installed", async () => {
  await platformUp(local, fakeRunner().runner);
  expect(helmReleaseStatus).not.toHaveBeenCalled();
});

test("a delivery release that is not found, as on a fresh profile, leaves Helm managing the argocd release", async () => {
  flagOn();
  vi.mocked(helmReleaseStatus).mockRejectedValue(
    new CommandError("helm", ["status"], {
      stdout: "",
      stderr: "Error: release: not found",
      code: 1,
    }),
  );
  await platformUp(local, fakeRunner().runner);
  expect(order.filter((step) => step.startsWith("configure:"))).toEqual([
    "configure:tls",
    "configure:kore-config-delivery",
    "configure:policy",
  ]);
});

test("any other failure reading the delivery release stops up, never a guess that Helm still owns the release", async () => {
  flagOn();
  const unreachable = new CommandError("helm", ["status"], {
    stdout: "",
    stderr: "Error: Kubernetes cluster unreachable",
    code: 1,
  });
  vi.mocked(helmReleaseStatus).mockRejectedValue(unreachable);
  await expect(platformUp(local, fakeRunner().runner)).rejects.toBe(
    unreachable,
  );
  expect(reconcileConfiguration).not.toHaveBeenCalled();
});
