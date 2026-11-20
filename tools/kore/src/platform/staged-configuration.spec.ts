// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
import { beforeEach, expect, test, vi } from "vitest";
import { enabledComponents, startsAfterDelivery } from "../config/index.js";
import { reconcileConfiguration } from "./reconcile.js";
import { prepareConfigurationRelease } from "./release-prerequisites.js";
import { reconcileStagedConfigurations } from "./staged-configuration.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../config/index.js");
vi.mock("./reconcile.js");
vi.mock("./release-prerequisites.js");

const repository = fakeRepository({ provider: "k3d" });
const policy = fakeComponent({ name: "policy", phase: "configuration" });
const keycloak = fakeComponent({
  name: "kore-platform-keycloak",
  phase: "configuration",
});
const backstage = fakeComponent({
  name: "kore-platform-backstage",
  phase: "configuration",
});

/** Every collaborator records its step, so a test can assert the whole order. */
let order: string[];

beforeEach(() => {
  vi.resetAllMocks();
  order = [];
  vi.mocked(prepareConfigurationRelease).mockImplementation(
    async (_r, _n, c) => {
      order.push(`prepare:${c.name}`);
    },
  );
  vi.mocked(reconcileConfiguration).mockImplementation(async (_r, _n, c) => {
    order.push(`reconcile:${c.name}`);
  });
  vi.mocked(enabledComponents).mockReturnValue([policy, keycloak, backstage]);
  vi.mocked(startsAfterDelivery).mockImplementation(
    (_environment, component) => component !== policy,
  );
});

test("only the releases that start after the delivery are reconciled, each prepared first, in catalog order", async () => {
  await reconcileStagedConfigurations(repository, fakeRunner().runner);

  expect(order).toEqual([
    "prepare:kore-platform-keycloak",
    "reconcile:kore-platform-keycloak",
    "prepare:kore-platform-backstage",
    "reconcile:kore-platform-backstage",
  ]);
});

test("each release is given the repository and runner of this run", async () => {
  const { runner } = fakeRunner();
  await reconcileStagedConfigurations(repository, runner);

  expect(reconcileConfiguration).toHaveBeenCalledWith(
    repository,
    runner,
    keycloak,
  );
  expect(prepareConfigurationRelease).toHaveBeenCalledWith(
    repository,
    runner,
    backstage,
  );
});

test("with no release staged, which is the portal off, nothing is prepared or reconciled", async () => {
  vi.mocked(enabledComponents).mockReturnValue([policy]);
  await reconcileStagedConfigurations(repository, fakeRunner().runner);

  expect(order).toEqual([]);
});

test("a staged release that fails stops the next one, so Backstage never starts without Keycloak", async () => {
  vi.mocked(reconcileConfiguration).mockRejectedValueOnce(
    new Error("statefulset/keycloak not ready"),
  );

  await expect(
    reconcileStagedConfigurations(repository, fakeRunner().runner),
  ).rejects.toThrow("statefulset/keycloak not ready");
  expect(reconcileConfiguration).toHaveBeenCalledTimes(1);
  expect(prepareConfigurationRelease).not.toHaveBeenCalledWith(
    repository,
    expect.anything(),
    backstage,
  );
});

test("a staged release that fails its preparation is not reconciled", async () => {
  vi.mocked(prepareConfigurationRelease).mockRejectedValue(
    new Error("the local CA is missing"),
  );

  await expect(
    reconcileStagedConfigurations(repository, fakeRunner().runner),
  ).rejects.toThrow("the local CA is missing");
  expect(reconcileConfiguration).not.toHaveBeenCalled();
});
