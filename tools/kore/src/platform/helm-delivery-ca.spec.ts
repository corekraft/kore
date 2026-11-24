// Docs: docs/decisions/0142-the-vps-environment-targets-the-persistent-k3s-node-as-a-managed-cluster.md
import { beforeEach, expect, test, vi } from "vitest";
import type { ChartDeliveryValues } from "../config/index.js";
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
  databaseRoutesDeliveryArgs: vi.fn(() => []),
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

beforeEach(configAnswers);

const delivery: ChartDeliveryValues = {
  charts: {},
  namespaces: {},
  gatewayClassName: "istio",
  platformDomain: "kore.internal",
  platformHostname: "*.platform.kore.internal",
};

function deliveryArgs(chartDelivery: ChartDeliveryValues): string[] {
  return helmUpgradeArgs(
    { ...fakeRepository(), chartDelivery },
    fakeComponent({ name: "kore-config-delivery" }),
  );
}

test("kore-config-delivery is handed inClusterCa when the delivery values carry it, so its AppProject admits the CA objects", () => {
  expect(deliveryArgs({ ...delivery, inClusterCa: true }).slice(-2)).toEqual([
    "--set",
    "inClusterCa=true",
  ]);
});

test("kore-config-delivery is handed no inClusterCa while the delivery values omit it, so the AppProject is unchanged", () => {
  expect(deliveryArgs(delivery).join(" ")).not.toContain("inClusterCa");
});
