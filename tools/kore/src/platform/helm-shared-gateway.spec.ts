// Docs: docs/decisions/0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md
import { beforeEach, expect, test, vi } from "vitest";
import { featureHelmArgs } from "../config/index.js";
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

beforeEach(configAnswers);

const golden = {
  repoURL: "https://github.com/corekraft/kore.git",
  revision: "a".repeat(40),
  environment: "local",
  templateImages: {
    "static-frontend": {
      image: "ghcr.io/o/fe",
      digest: `sha256:${"1".repeat(64)}`,
    },
    "kotlin-bff": {
      image: "ghcr.io/o/bff",
      digest: `sha256:${"2".repeat(64)}`,
    },
  },
  ingress: { platformDomain: "kore.internal", gatewayClassName: "istio" },
};

test("with sharedGateway on, kore-golden-path-delivery is given it as its last argument, so the sync labels app namespaces", () => {
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: { ...golden, sharedGateway: true } },
    fakeComponent({ name: "kore-golden-path-delivery" }),
  );
  expect(args.slice(-2)).toEqual(["--set", "sharedGateway=true"]);
});

test("with sharedGateway off, kore-golden-path-delivery gets no sharedGateway argument, so its values are unchanged", () => {
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: { ...golden, sharedGateway: false } },
    fakeComponent({ name: "kore-golden-path-delivery" }),
  );
  expect(args.some((arg) => arg.includes("sharedGateway"))).toBe(false);
});

test("sharedGateway is passed only to kore-golden-path-delivery, never to another component", () => {
  vi.mocked(featureHelmArgs).mockReturnValue([]);
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: { ...golden, sharedGateway: true } },
    fakeComponent({ name: "kore-platform-config" }),
  );
  expect(args.some((arg) => arg.includes("sharedGateway"))).toBe(false);
});
