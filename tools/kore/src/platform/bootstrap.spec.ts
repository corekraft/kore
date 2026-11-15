import { beforeEach, expect, test, vi } from "vitest";
import {
  assertExpectedCluster,
  ClusterUnavailableError,
  clusterUp,
} from "../cluster/index.js";
import { enabledComponents, isLocalProvider } from "../config/index.js";
import {
  applyChartCredential,
  ensureLocalSigningPublicKey,
  ensureRegistryAuth,
  ensureRegistryTrust,
} from "../images/index.js";
import { closeExistingAdmissionGate } from "./admission-gate.js";
import {
  bootstrapControllers,
  closeApplicationAdmission,
} from "./bootstrap.js";
import { assertNoOrphanedReleases } from "./gated-release.js";
import {
  ensureKeycloakAdmin,
  ensureKeycloakProviderCredentials,
} from "./keycloak-admin.js";
import * as readinessGate from "./readiness-gate.js";
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
vi.mock("./keycloak-admin.js");
vi.mock("./readiness-gate.js");
vi.mock("./reconcile.js");

const local = fakeRepository({ provider: "k3d" });
const managed = fakeRepository({ provider: "managed" });
const registry = fakeComponent({ name: "oci-registry", phase: "bootstrap" });
const gate = fakeComponent({ name: "gate", phase: "core" });
const policy = fakeComponent({ name: "policy", phase: "configuration" });
const enforce = fakeComponent({ name: "enforce", phase: "enforcement" });

/** Every collaborator records its name, so a test can assert the whole order. */
let order: string[];

beforeEach(() => {
  order = [];
  const record = (name: string) => async () => void order.push(name);
  vi.mocked(assertExpectedCluster).mockImplementation(record("cluster"));
  vi.mocked(clusterUp).mockImplementation(record("cluster-up"));
  vi.mocked(closeExistingAdmissionGate).mockImplementation(
    record("close-gate"),
  );
  vi.mocked(assertNoOrphanedReleases).mockImplementation(record("orphans"));
  vi.mocked(ensureRegistryAuth).mockImplementation(record("registry-auth"));
  vi.mocked(ensureRegistryTrust).mockImplementation(record("registry-trust"));
  vi.mocked(applyChartCredential).mockImplementation(async () => {
    order.push("chart-credential");
    return true;
  });
  vi.mocked(ensureLocalSigningPublicKey).mockImplementation(
    record("signing-key"),
  );
  vi.mocked(ensureKeycloakAdmin).mockImplementation(async () => {
    order.push("keycloak-admin");
    return true;
  });
  vi.mocked(ensureKeycloakProviderCredentials).mockImplementation(async () => {
    order.push("keycloak-provider-credentials");
    return true;
  });
  vi.mocked(reconcileIfNeeded).mockImplementation(async (_repo, _runner, c) => {
    order.push(`reconcile:${c.name}`);
  });
  vi.mocked(isLocalProvider).mockImplementation(
    (environment) => environment.provider === "k3d",
  );
  vi.mocked(enabledComponents).mockReturnValue([
    registry,
    gate,
    policy,
    enforce,
  ]);
});

test("a local cluster that is up is used as it is, with nothing created", async () => {
  await bootstrapControllers(local, fakeRunner().runner);
  expect(clusterUp).not.toHaveBeenCalled();
  expect(order[0]).toBe("cluster");
});

test("a local cluster that is not there is created, then bootstrap continues", async () => {
  vi.mocked(assertExpectedCluster).mockRejectedValueOnce(
    new ClusterUnavailableError("k3d-kore-local"),
  );
  await bootstrapControllers(local, fakeRunner().runner);
  expect(order.slice(0, 3)).toEqual(["cluster-up", "close-gate", "orphans"]);
});

test("a managed cluster that is not there is never created, and the failure stops bootstrap", async () => {
  vi.mocked(assertExpectedCluster).mockRejectedValueOnce(
    new ClusterUnavailableError("managed"),
  );
  await expect(
    bootstrapControllers(managed, fakeRunner().runner),
  ).rejects.toThrow(ClusterUnavailableError);
  expect(clusterUp).not.toHaveBeenCalled();
  expect(order).toEqual([]);
});

test("a cluster failure that is not unavailability is rethrown, never masked by creating a cluster", async () => {
  vi.mocked(assertExpectedCluster).mockRejectedValueOnce(
    new Error("kubectl crashed"),
  );
  await expect(
    bootstrapControllers(local, fakeRunner().runner),
  ).rejects.toThrow("kubectl crashed");
  expect(clusterUp).not.toHaveBeenCalled();
});

test("bootstrap closes the admission gate, then checks for orphaned releases, before any component", async () => {
  await bootstrapControllers(local, fakeRunner().runner);
  expect(order.slice(0, 3)).toEqual(["cluster", "close-gate", "orphans"]);
  expect(order[3]).toBe("registry-auth");
});

test("each bootstrap component is reconciled in order, and configuration and enforcement components are left to up", async () => {
  await bootstrapControllers(local, fakeRunner().runner);
  const reconciled = order.filter((step) => step.startsWith("reconcile:"));
  expect(reconciled).toEqual(["reconcile:oci-registry", "reconcile:gate"]);
});

test("the registry's credentials are ensured before its release, and its CA is trusted after it", async () => {
  await bootstrapControllers(local, fakeRunner().runner);
  expect(order.indexOf("registry-auth")).toBeLessThan(
    order.indexOf("reconcile:oci-registry"),
  );
  expect(order.indexOf("reconcile:oci-registry")).toBeLessThan(
    order.indexOf("registry-trust"),
  );
});

test("the local signing key is written last on a local environment", async () => {
  await bootstrapControllers(local, fakeRunner().runner);
  expect(order.at(-1)).toBe("signing-key");
});

test("a managed environment never writes the local signing key", async () => {
  await bootstrapControllers(managed, fakeRunner().runner);
  expect(ensureLocalSigningPublicKey).not.toHaveBeenCalled();
});

test("a component that fails to reconcile stops bootstrap before the later steps", async () => {
  vi.mocked(reconcileIfNeeded).mockRejectedValueOnce(new Error("crd stuck"));
  await expect(
    bootstrapControllers(local, fakeRunner().runner),
  ).rejects.toThrow("crd stuck");
  expect(ensureRegistryTrust).not.toHaveBeenCalled();
  expect(ensureLocalSigningPublicKey).not.toHaveBeenCalled();
});

test("the Argo CD registry credential is applied right after Argo CD is installed, and after no other release", async () => {
  const argocd = fakeComponent({ name: "argocd", phase: "core" });
  vi.mocked(enabledComponents).mockReturnValue([gate, argocd, registry]);
  const { runner } = fakeRunner();
  await bootstrapControllers(local, runner);
  expect(
    order.filter(
      (step) => step.startsWith("reconcile:") || step === "chart-credential",
    ),
  ).toEqual([
    "reconcile:gate",
    "reconcile:argocd",
    "chart-credential",
    "reconcile:oci-registry",
  ]);
  expect(applyChartCredential).toHaveBeenCalledTimes(1);
  expect(applyChartCredential).toHaveBeenCalledWith(local, runner);
});

test("the Keycloak admin Secret is streamed right after the operator creates its namespace, and not without the operator", async () => {
  const operator = fakeComponent({ name: "keycloak-operator", phase: "core" });
  vi.mocked(enabledComponents).mockReturnValue([gate, operator, registry]);
  const { runner } = fakeRunner();
  await bootstrapControllers(local, runner);
  expect(
    order.filter(
      (step) => step.startsWith("reconcile:") || step === "keycloak-admin",
    ),
  ).toEqual([
    "reconcile:gate",
    "reconcile:keycloak-operator",
    "keycloak-admin",
    "reconcile:oci-registry",
  ]);
  expect(ensureKeycloakAdmin).toHaveBeenCalledWith(local, runner);
  vi.mocked(ensureKeycloakAdmin).mockClear();
  vi.mocked(enabledComponents).mockReturnValue([gate, registry]);
  await bootstrapControllers(local, runner);
  expect(ensureKeycloakAdmin).not.toHaveBeenCalled();
});

test("the Keycloak provider credential is streamed right after the provider installs, and not without it", async () => {
  const provider = fakeComponent({ name: "keycloak-provider", phase: "core" });
  vi.mocked(enabledComponents).mockReturnValue([gate, provider, registry]);
  const { runner } = fakeRunner();
  await bootstrapControllers(local, runner);
  expect(
    order.filter(
      (step) =>
        step.startsWith("reconcile:") ||
        step === "keycloak-provider-credentials",
    ),
  ).toEqual([
    "reconcile:gate",
    "reconcile:keycloak-provider",
    "keycloak-provider-credentials",
    "reconcile:oci-registry",
  ]);
  expect(ensureKeycloakProviderCredentials).toHaveBeenCalledWith(local, runner);
  vi.mocked(ensureKeycloakProviderCredentials).mockClear();
  vi.mocked(enabledComponents).mockReturnValue([gate, registry]);
  await bootstrapControllers(local, runner);
  expect(ensureKeycloakProviderCredentials).not.toHaveBeenCalled();
});

test("closing the application admission gate is the existing gate's close, with the same runner", async () => {
  const { runner } = fakeRunner();
  await closeApplicationAdmission(local, runner);
  expect(closeExistingAdmissionGate).toHaveBeenCalledWith(local, runner);
});

test("bootstrap re-exports the readiness gate's open and degraded-close operations unchanged", async () => {
  const bootstrap = await import("./bootstrap.js");
  expect(bootstrap.openApplicationAdmission).toBe(
    readinessGate.openApplicationAdmission,
  );
  expect(bootstrap.closeGateIfDegraded).toBe(readinessGate.closeGateIfDegraded);
});
