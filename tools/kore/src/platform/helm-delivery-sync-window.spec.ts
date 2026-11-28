// Docs: docs/decisions/0153-rollback-goes-through-the-release-owner-and-host-maintenance-never-drains.md (the sync window)
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
  suborgDeliveryArgs: vi.fn(),
  applicationImageArgs: vi.fn(),
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

test("kore-config-delivery is handed syncWindow when the delivery values carry it, so its AppProject can carry the maintenance deny window", () => {
  expect(deliveryArgs({ ...delivery, syncWindow: true }).slice(-2)).toEqual([
    "--set",
    "syncWindow=true",
  ]);
});

test("kore-config-delivery is handed no syncWindow while the delivery values omit it, so the AppProject is unchanged", () => {
  expect(deliveryArgs(delivery).join(" ")).not.toContain("syncWindow");
});
