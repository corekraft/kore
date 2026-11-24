// Docs: infra/catalog/compatibility.md (the Keycloak operator's startup probe, issue 2011)
import { beforeEach, expect, test, vi } from "vitest";
import { keycloakOperatorProbeHelmArgs } from "../config/index.js";
import { helmUpgradeArgs } from "./helm.js";
import { configAnswers } from "./helm-support.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";

vi.mock("../config/index.js", () => ({
  absolute: vi.fn(),
  alertEmailHelmArgs: vi.fn(),
  alertForwardingHelmArgs: vi.fn(),
  componentValues: vi.fn(),
  componentVersion: vi.fn(),
  dashboardSidecarHelmArgs: vi.fn(),
  prometheusPortalHelmArgs: vi.fn(),
  keycloakOperatorProbeHelmArgs: vi.fn(),
  expandVersions: vi.fn(),
  featureHelmArgs: vi.fn(),
  gatewayClassName: vi.fn(),
  noMatchPolicy: vi.fn(),
  platformHelmArgs: vi.fn(),
  registeredServiceHelmArgs: vi.fn(),
  registryConsumers: ["oci-registry", "kore-image-policy"],
  registryHelmArgs: vi.fn(),
}));
vi.mock("./patches.js");

const repository = fakeRepository();
const threshold = "operator.startupProbe.failureThreshold=30";

beforeEach(configAnswers);

test("the keycloak-operator release takes the startup probe threshold last, and no other component does", () => {
  vi.mocked(keycloakOperatorProbeHelmArgs).mockImplementation((_env, name) =>
    name === "keycloak-operator" ? ["--set", threshold] : [],
  );
  expect(
    helmUpgradeArgs(
      repository,
      fakeComponent({ name: "keycloak-operator" }),
    ).slice(-2),
  ).toEqual(["--set", threshold]);
  expect(helmUpgradeArgs(repository, fakeComponent())).not.toContain(threshold);
  expect(keycloakOperatorProbeHelmArgs).toHaveBeenCalledWith(
    repository.environment,
    "keycloak-operator",
  );
});
