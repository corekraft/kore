import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled } from "../config/index.js";
import { ensureLocalCaTrust } from "../security/index.js";
import { enrollSharedGatewayRoute } from "./enrollment.js";
import { waitForKeycloakRealm } from "./keycloak-realm-wait.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";
import { prepareConfigurationRelease } from "./release-prerequisites.js";

vi.mock("../config/index.js");
vi.mock("../security/index.js");
vi.mock("./enrollment.js");
vi.mock("./keycloak-realm-wait.js");

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
// Docs: docs/decisions/0134-the-shared-gateway-admits-routes-only-from-platform-labelled-namespaces.md

const repository = fakeRepository();
const portal = fakeComponent({
  name: "kore-platform-backstage",
  namespace: "backstage",
});
const other = fakeComponent({ name: "policy", namespace: "kore-system" });

/** The steps taken, in order. */
let order: string[];

beforeEach(() => {
  vi.resetAllMocks();
  order = [];
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(ensureLocalCaTrust).mockImplementation(async (_r, _n, ns) => {
    order.push(`ca:${ns}`);
  });
  vi.mocked(enrollSharedGatewayRoute).mockImplementation(async (_r, _n, c) => {
    order.push(`shared-gateway:${c.name}`);
  });
  vi.mocked(waitForKeycloakRealm).mockImplementation(async () => {
    order.push("keycloak-realm");
  });
});

test("with platform-dns on the portal's pods get the local CA, in the portal's namespace, before its route is enrolled", async () => {
  const { runner } = fakeRunner();
  await prepareConfigurationRelease(repository, runner, portal);
  expect(order).toEqual([
    "ca:backstage",
    "shared-gateway:kore-platform-backstage",
    "keycloak-realm",
  ]);
  expect(ensureLocalCaTrust).toHaveBeenCalledWith(
    repository,
    runner,
    "backstage",
  );
});

test("the local CA is applied for no other component, nor for the portal with platform-dns off", async () => {
  await prepareConfigurationRelease(repository, fakeRunner().runner, other);
  vi.mocked(featureEnabled).mockReturnValue(false);
  await prepareConfigurationRelease(repository, fakeRunner().runner, portal);
  expect(ensureLocalCaTrust).not.toHaveBeenCalled();
});

test("every component is offered to the shared Gateway enrollment, which decides on its own flags", async () => {
  const { runner } = fakeRunner();
  await prepareConfigurationRelease(repository, runner, other);
  expect(enrollSharedGatewayRoute).toHaveBeenCalledWith(
    repository,
    runner,
    other,
  );
});

test("a missing local CA stops the portal's preparation before its namespace is enrolled", async () => {
  vi.mocked(ensureLocalCaTrust).mockRejectedValue(
    new Error("the local CA is missing"),
  );
  await expect(
    prepareConfigurationRelease(repository, fakeRunner().runner, portal),
  ).rejects.toThrow("the local CA is missing");
  expect(enrollSharedGatewayRoute).not.toHaveBeenCalled();
});

test("the portal waits for the Keycloak realm after its other prerequisites, so the proxy never starts against a Keycloak with no endpoint", async () => {
  const { runner } = fakeRunner();
  await prepareConfigurationRelease(repository, runner, portal);
  expect(waitForKeycloakRealm).toHaveBeenCalledWith(repository, runner);
  expect(order.at(-1)).toBe("keycloak-realm");
});

test("no other component waits for the Keycloak realm", async () => {
  await prepareConfigurationRelease(repository, fakeRunner().runner, other);
  expect(waitForKeycloakRealm).not.toHaveBeenCalled();
});

test("a realm that never answers stops the portal's release before it is applied", async () => {
  vi.mocked(waitForKeycloakRealm).mockRejectedValue(
    new Error("the Keycloak realm platform did not answer"),
  );
  await expect(
    prepareConfigurationRelease(repository, fakeRunner().runner, portal),
  ).rejects.toThrow("the Keycloak realm platform did not answer");
});
