// Docs: infra/plans/15-next-horizon.md (issue #1705: prometheus-server is OOMKilled at its 1Gi limit with platform-portal installed)
import { beforeEach, expect, test, vi } from "vitest";
import { prometheusPortalHelmArgs } from "../config/index.js";
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
  suborgDeliveryArgs: vi.fn(),
  registeredServiceHelmArgs: vi.fn(),
  registryConsumers: ["oci-registry", "kore-image-policy"],
  registryHelmArgs: vi.fn(),
}));
vi.mock("./patches.js");

const repository = fakeRepository();
const memory = "server.resources.limits.memory=2Gi";

beforeEach(configAnswers);

test("prometheus takes the portal memory arguments last, and no other component does", () => {
  vi.mocked(prometheusPortalHelmArgs).mockImplementation((_env, name) =>
    name === "prometheus" ? ["--set", memory] : [],
  );
  expect(
    helmUpgradeArgs(repository, fakeComponent({ name: "prometheus" })).slice(
      -2,
    ),
  ).toEqual(["--set", memory]);
  expect(helmUpgradeArgs(repository, fakeComponent())).not.toContain(memory);
});
