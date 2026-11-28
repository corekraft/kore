import { beforeEach, expect, test, vi } from "vitest";
import type { ChartDeliveryValues } from "../config/index.js";
import { helmUpgradeArgs } from "./helm.js";
import { configAnswers } from "./helm-support.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";

vi.mock("../config/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/index.js")>()),
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

const repository = fakeRepository();

beforeEach(configAnswers);

const delivery = {
  charts: {
    "kore-local-tls": {
      chart: "reg/charts/kore-local-tls",
      digest: "sha256:1",
    },
  },
  namespaces: { "kore-local-tls": "cert" },
  gatewayClassName: "istio",
  platformDomain: "kore.internal",
  platformHostname: "*.platform.kore.internal",
};

// A delivery value still carrying the removed alias, as an older render would hand it over.
const staleDelivery: ChartDeliveryValues & { platformDeprecatedAlias: string } =
  {
    ...delivery,
    platformDeprecatedAlias: "kore.local",
  };

test("kore-config-delivery is never handed a deprecated alias, even when a stale delivery value still carries one (ADR 0176)", () => {
  const args = helmUpgradeArgs(
    {
      ...repository,
      chartDelivery: staleDelivery,
    },
    fakeComponent({ name: "kore-config-delivery" }),
  );
  expect(args.slice(-2)).toEqual([
    "--set-string",
    "platformHostname=*.platform.kore.internal",
  ]);
  expect(args.some((arg) => arg.startsWith("platformDeprecatedAlias="))).toBe(
    false,
  );
});
