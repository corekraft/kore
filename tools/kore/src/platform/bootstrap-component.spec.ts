import { beforeEach, expect, test, vi } from "vitest";
import {
  applyChartCredential,
  ensureRegistryAuth,
  ensureRegistryTrust,
} from "../images/index.js";
import { bootstrapComponent } from "./bootstrap-component.js";
import { enrollSharedGatewayRoute } from "./enrollment.js";
import { waitForGatekeeperAdmission } from "./gatekeeper-admission.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";
import {
  ensureKeycloakProviderCredentials,
  ensurePortalSecrets,
} from "./portal-secrets.js";
import { assertMetricsServerUnowned } from "./metrics-server-ownership.js";
import { reconcileIfNeeded } from "./reconcile.js";

vi.mock("../images/index.js");
vi.mock("./enrollment.js");
vi.mock("./gatekeeper-admission.js");
vi.mock("./metrics-server-ownership.js");
vi.mock("./portal-secrets.js");
vi.mock("./reconcile.js");

const repository = fakeRepository();

/** Every collaborator records its step, so a test can assert the whole order. */
let order: string[];

/** Runs one component and returns the steps it took. */
async function steps(name: string, afterGatekeeper = false) {
  await bootstrapComponent(
    repository,
    fakeRunner().runner,
    fakeComponent({ name }),
    afterGatekeeper,
  );
  return order;
}

beforeEach(() => {
  order = [];
  const record = (step: string) => async () => void order.push(step);
  vi.mocked(waitForGatekeeperAdmission).mockImplementation(
    record("await-gatekeeper"),
  );
  vi.mocked(ensureRegistryAuth).mockImplementation(record("registry-auth"));
  vi.mocked(ensureRegistryTrust).mockImplementation(record("registry-trust"));
  vi.mocked(applyChartCredential).mockImplementation(async () => {
    order.push("chart-credential");
    return true;
  });
  vi.mocked(ensurePortalSecrets).mockImplementation(async () => {
    order.push("portal-secrets");
  });
  vi.mocked(ensureKeycloakProviderCredentials).mockImplementation(async () => {
    order.push("keycloak-provider-credentials");
    return true;
  });
  vi.mocked(assertMetricsServerUnowned).mockImplementation(
    record("assert-metrics-server-unowned"),
  );
  vi.mocked(reconcileIfNeeded).mockImplementation(async (_r, _n, c) => {
    order.push(`reconcile:${c.name}`);
  });
});

test("a component after Gatekeeper is applied only once Gatekeeper's webhook answers", async () => {
  expect(await steps("agentgateway-crds", true)).toEqual([
    "await-gatekeeper",
    "reconcile:agentgateway-crds",
  ]);
});

test("Gatekeeper itself and the components ahead of it wait for nothing", async () => {
  expect(await steps("gatekeeper", false)).toEqual(["reconcile:gatekeeper"]);
});

test("a Gatekeeper webhook that is not ready stops the component before anything is applied", async () => {
  vi.mocked(waitForGatekeeperAdmission).mockRejectedValueOnce(
    new Error("gatekeeper-webhook-service has no ready endpoints"),
  );
  await expect(steps("agentgateway-crds", true)).rejects.toThrow(
    "gatekeeper-webhook-service has no ready endpoints",
  );
  expect(reconcileIfNeeded).not.toHaveBeenCalled();
});

test("the registry's credentials are ensured before its release, and its CA is trusted after it", async () => {
  expect(await steps("oci-registry")).toEqual([
    "registry-auth",
    "reconcile:oci-registry",
    "registry-trust",
  ]);
});

test("the Argo CD registry credential is applied right after Argo CD is installed", async () => {
  expect(await steps("argocd")).toEqual([
    "reconcile:argocd",
    "chart-credential",
  ]);
});

test("the portal Secrets are streamed right after the Keycloak operator creates its namespace", async () => {
  expect(await steps("keycloak-operator")).toEqual([
    "reconcile:keycloak-operator",
    "portal-secrets",
  ]);
});

test("the Keycloak provider credential is streamed right after the provider installs", async () => {
  expect(await steps("keycloak-provider")).toEqual([
    "reconcile:keycloak-provider",
    "keycloak-provider-credentials",
  ]);
});

test("the metrics-server ClusterRole's owner is checked before its release is applied", async () => {
  expect(await steps("metrics-server")).toEqual([
    "assert-metrics-server-unowned",
    "reconcile:metrics-server",
  ]);
});

test("a metrics-server ClusterRole owned by the k3s add-on stops the release before Helm runs", async () => {
  vi.mocked(assertMetricsServerUnowned).mockRejectedValueOnce(
    new Error("owned by the k3s add-on"),
  );
  await expect(steps("metrics-server")).rejects.toThrow(
    "owned by the k3s add-on",
  );
  expect(reconcileIfNeeded).not.toHaveBeenCalled();
});

test("an ordinary component is reconciled with no secret or trust step", async () => {
  expect(await steps("cert-manager")).toEqual(["reconcile:cert-manager"]);
});

test("a component that fails to reconcile skips the steps that follow it", async () => {
  vi.mocked(reconcileIfNeeded).mockRejectedValueOnce(new Error("crd stuck"));
  await expect(steps("oci-registry")).rejects.toThrow("crd stuck");
  expect(ensureRegistryTrust).not.toHaveBeenCalled();
});

test("a route-bearing bootstrap component has its namespace enrolled for the shared Gateway before its release is applied and waited on", async () => {
  vi.mocked(enrollSharedGatewayRoute).mockImplementation(async (_r, _n, c) => {
    order.push(`enroll-shared-gateway:${c.name}`);
  });
  expect(await steps("oci-registry")).toEqual([
    "registry-auth",
    "enroll-shared-gateway:oci-registry",
    "reconcile:oci-registry",
    "registry-trust",
  ]);
});
