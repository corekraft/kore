// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md
import { beforeEach, expect, test, vi } from "vitest";
import {
  enabledComponents,
  helmInstalledComponents,
  releaseOwner,
  type Repository,
} from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { prepareConfigurationRelease } from "./release-prerequisites.js";
import { helmReleaseStatus } from "./probe.js";
import { awaitArgocdDelivery, reconcileConfigurations } from "./handover.js";
import { reconcileConfiguration } from "./reconcile.js";
import { ReadinessTimeout, pollUntil } from "./readiness-poll.js";
import { waitForApplications } from "./readiness-argocd.js";
import { readinessFailure } from "./readiness.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../config/index.js");
vi.mock("./release-prerequisites.js");
vi.mock("./probe.js");
vi.mock("./reconcile.js");
vi.mock("./readiness.js");
vi.mock("./readiness-argocd.js");
// Only the poll is replaced: ReadinessTimeout stays the real error class.
vi.mock("./readiness-poll.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./readiness-poll.js")>()),
  pollUntil: vi.fn(),
}));

const core = fakeComponent({ name: "gate", phase: "core" });
const policy = fakeComponent({ name: "policy", phase: "configuration" });
const enforce = fakeComponent({ name: "enforce", phase: "enforcement" });
const handed = fakeComponent({
  name: "tls",
  phase: "configuration",
  owner: "argocd",
});
const delivery = fakeComponent({
  name: "kore-config-delivery",
  phase: "configuration",
  namespace: "argocd",
  timeout: "5m",
});
const opa = fakeComponent({
  name: "opa-authorizer",
  phase: "configuration",
  namespace: "opa-system",
  timeout: "3s",
  owner: "argocd",
  readiness: ["deployment/opa-authorizer"],
});
const platformConfig = fakeComponent({
  name: "kore-platform-config",
  phase: "configuration",
  namespace: "kore-system",
  timeout: "3s",
  owner: "argocd",
  readiness: ["gateway/kore-gateway"],
});

const repository: Repository = fakeRepository({
  provider: "k3d",
  kubeContext: "k3d-kore-local",
});

/** The flag is on: Helm lists the argocd release until the delivery release is installed. */
function handoverFlagOn(): void {
  vi.mocked(helmInstalledComponents).mockImplementation(
    (_repository, deliveryInstalled) =>
      deliveryInstalled
        ? [core, policy, delivery]
        : [core, handed, delivery, policy],
  );
}

/** The flag is off: nothing is Argo CD owned, so Helm keeps every release. */
function handoverFlagOff(): void {
  vi.mocked(helmInstalledComponents).mockReturnValue([core, policy, enforce]);
}

/** The flag is on for the delivery wait: two releases are Argo CD owned, the delivery is kore owned. */
function deliveryFlagOn(): void {
  vi.mocked(enabledComponents).mockReturnValue([delivery, opa, platformConfig]);
  vi.mocked(releaseOwner).mockImplementation((_environment, component) =>
    component.owner === "argocd" ? "argocd" : "kore",
  );
}

/** The names of the components reconciled through Helm, in the order they were reconciled. */
function reconciledNames(): string[] {
  return vi.mocked(reconcileConfiguration).mock.calls.map(([, , c]) => c.name);
}

beforeEach(() => {
  vi.resetAllMocks();
  handoverFlagOff();
  vi.mocked(helmReleaseStatus).mockResolvedValue(undefined);
  vi.mocked(readinessFailure).mockResolvedValue(undefined);
  vi.mocked(waitForApplications).mockResolvedValue(undefined);
  vi.mocked(pollUntil).mockResolvedValue(undefined);
  deliveryFlagOn();
});

test("only configuration and enforcement components are reconciled through Helm, in catalog order", async () => {
  handoverFlagOff();
  await reconcileConfigurations(repository, fakeRunner().runner);
  expect(reconciledNames()).toEqual(["policy", "enforce"]);
});

test("an argocd release is still reconciled by Helm while kore-config-delivery is not installed, so a failed delivery leaves Helm managing it", async () => {
  handoverFlagOn();
  vi.mocked(helmReleaseStatus).mockResolvedValue("failed");
  await reconcileConfigurations(repository, fakeRunner().runner);
  expect(reconciledNames()).toEqual(["tls", "kore-config-delivery", "policy"]);
});

test("an argocd release is not reconciled by Helm once kore-config-delivery is deployed, and the delivery release still is", async () => {
  handoverFlagOn();
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  const { runner } = fakeRunner();
  await reconcileConfigurations(repository, runner);
  expect(reconciledNames()).toEqual(["kore-config-delivery", "policy"]);
  expect(helmReleaseStatus).toHaveBeenCalledWith(repository, runner, delivery);
});

test("with the flag off the handover never asks the cluster whether the delivery release is installed", async () => {
  handoverFlagOff();
  await reconcileConfigurations(repository, fakeRunner().runner);
  expect(helmReleaseStatus).not.toHaveBeenCalled();
});

test("a delivery release that is not found, as on a fresh profile, leaves Helm managing the argocd release", async () => {
  handoverFlagOn();
  vi.mocked(helmReleaseStatus).mockRejectedValue(
    new CommandError("helm", ["status"], {
      stdout: "",
      stderr: "Error: release: not found",
      code: 1,
    }),
  );
  await reconcileConfigurations(repository, fakeRunner().runner);
  expect(reconciledNames()).toEqual(["tls", "kore-config-delivery", "policy"]);
});

test("any other failure reading the delivery release stops the handover, never a guess that Helm still owns the release", async () => {
  handoverFlagOn();
  const unreachable = new CommandError("helm", ["status"], {
    stdout: "",
    stderr: "Error: Kubernetes cluster unreachable",
    code: 1,
  });
  vi.mocked(helmReleaseStatus).mockRejectedValue(unreachable);
  await expect(
    reconcileConfigurations(repository, fakeRunner().runner),
  ).rejects.toBe(unreachable);
  expect(reconcileConfiguration).not.toHaveBeenCalled();
});

test("with the flag off no release is probed by the delivery wait", async () => {
  vi.mocked(releaseOwner).mockReturnValue("kore");
  await awaitArgocdDelivery(repository, fakeRunner().runner);
  expect(pollUntil).not.toHaveBeenCalled();
  expect(waitForApplications).not.toHaveBeenCalled();
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

test("the Applications are awaited before any Argo CD owned release is polled", async () => {
  await awaitArgocdDelivery(repository, fakeRunner().runner);
  const applications =
    vi.mocked(waitForApplications).mock.invocationCallOrder[0];
  const polled = vi.mocked(pollUntil).mock.invocationCallOrder[0];
  expect(applications).toBeLessThan(polled!);
});

test("each Argo CD owned release is polled within its own catalog timeout, and a kore-owned release is not polled here", async () => {
  await awaitArgocdDelivery(repository, fakeRunner().runner);
  expect(pollUntil).toHaveBeenCalledTimes(2);
  expect(pollUntil).toHaveBeenNthCalledWith(1, "3s", expect.any(Function));
  expect(pollUntil).toHaveBeenNthCalledWith(2, "3s", expect.any(Function));
});

test("the poll probes its own release with the same repository and runner, and returns that release's reason", async () => {
  const { runner } = fakeRunner();
  vi.mocked(readinessFailure).mockResolvedValueOnce(
    "deployment/opa-authorizer not ready",
  );
  await awaitArgocdDelivery(repository, runner);
  const [, probe] = vi.mocked(pollUntil).mock.calls[0]!;

  expect(await probe()).toBe("deployment/opa-authorizer not ready");
  expect(readinessFailure).toHaveBeenCalledWith(repository, runner, opa);
});

test("a release that runs out of time fails naming it, its bound, its last reason and the command to describe it, and the next release is not polled", async () => {
  vi.mocked(pollUntil).mockRejectedValueOnce(
    new ReadinessTimeout(
      "deployment/opa-authorizer not ready (rollout complete and a replica available) within 3s: deployment/opa-authorizer has no available replicas",
    ),
  );

  await expect(
    awaitArgocdDelivery(repository, fakeRunner().runner),
  ).rejects.toThrow(
    "argocd-owned release opa-authorizer is not ready after 3s: deployment/opa-authorizer not ready (rollout complete and a replica available) within 3s: deployment/opa-authorizer has no available replicas; run kubectl --context k3d-kore-local -n opa-system describe deployment/opa-authorizer",
  );
  expect(pollUntil).toHaveBeenCalledTimes(1);
});

test("a poll error that is not a timeout is rethrown as itself, never reported as a timeout", async () => {
  const forbidden = new Error('secrets "x" is forbidden: Forbidden');
  vi.mocked(pollUntil).mockRejectedValueOnce(forbidden);

  await expect(
    awaitArgocdDelivery(repository, fakeRunner().runner),
  ).rejects.toBe(forbidden);
});

test("Argo CD owned releases with no enabled kore-config-delivery fail naming it, since no Application can be read", async () => {
  vi.mocked(enabledComponents).mockReturnValue([opa, platformConfig]);

  await expect(
    awaitArgocdDelivery(repository, fakeRunner().runner),
  ).rejects.toThrow(
    "kore-config-delivery is not enabled, so the Applications that Argo CD owns cannot be awaited",
  );
  expect(waitForApplications).not.toHaveBeenCalled();
  expect(pollUntil).not.toHaveBeenCalled();
});

test("an Application that is not Synced and Healthy fails the wait with its name, before any release is polled", async () => {
  vi.mocked(waitForApplications).mockRejectedValue(
    new Error(
      "Application golden-path-example is Synced and Progressing; run kubectl --context k3d-kore-local -n argocd describe application golden-path-example",
    ),
  );

  await expect(
    awaitArgocdDelivery(repository, fakeRunner().runner),
  ).rejects.toThrow(
    "Application golden-path-example is Synced and Progressing",
  );
  expect(pollUntil).not.toHaveBeenCalled();
});

test("each release is prepared before it is reconciled, in catalog order, so a route's namespace is enrolled before its readiness wait", async () => {
  vi.mocked(helmInstalledComponents).mockReturnValue([policy, enforce]);
  const order: string[] = [];
  vi.mocked(prepareConfigurationRelease).mockImplementation(
    async (_r, _n, c) => {
      order.push(`prepare:${c.name}`);
    },
  );
  vi.mocked(reconcileConfiguration).mockImplementation(async (_r, _n, c) => {
    order.push(`reconcile:${c.name}`);
  });
  await reconcileConfigurations(repository, fakeRunner().runner);
  expect(order).toEqual([
    "prepare:policy",
    "reconcile:policy",
    "prepare:enforce",
    "reconcile:enforce",
  ]);
});

test("a release that fails its preparation is not reconciled", async () => {
  vi.mocked(helmInstalledComponents).mockReturnValue([policy]);
  vi.mocked(prepareConfigurationRelease).mockRejectedValue(
    new Error("the local CA is missing"),
  );
  await expect(
    reconcileConfigurations(repository, fakeRunner().runner),
  ).rejects.toThrow("the local CA is missing");
  expect(reconcileConfiguration).not.toHaveBeenCalled();
});

test("an Argo CD owned release that Argo CD has taken over is still prepared, and Helm does not release it", async () => {
  handoverFlagOn();
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
  const { runner } = fakeRunner();
  await reconcileConfigurations(repository, runner);
  expect(prepareConfigurationRelease).toHaveBeenCalledWith(
    repository,
    runner,
    handed,
  );
  expect(reconciledNames()).toEqual(["kore-config-delivery", "policy"]);
});
