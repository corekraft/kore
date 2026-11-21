import { beforeEach, expect, test, vi } from "vitest";
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

test("kore-config-delivery is handed the deprecated alias beside the domain, so the Argo CD Applications serve it too (ADR 0132)", () => {
  const args = helmUpgradeArgs(
    {
      ...repository,
      chartDelivery: { ...delivery, platformDeprecatedAlias: "kore.local" },
    },
    fakeComponent({ name: "kore-config-delivery" }),
  );
  expect(args.slice(-4)).toEqual([
    "--set-string",
    "platformHostname=*.platform.kore.internal",
    "--set-string",
    "platformDeprecatedAlias=kore.local",
  ]);
});

test("kore-config-delivery gets no alias argument when the environment declares none", () => {
  const args = helmUpgradeArgs(
    { ...repository, chartDelivery: delivery },
    fakeComponent({ name: "kore-config-delivery" }),
  );
  expect(args).not.toContain("platformDeprecatedAlias=kore.local");
  expect(args.some((arg) => arg.startsWith("platformDeprecatedAlias="))).toBe(
    false,
  );
});
