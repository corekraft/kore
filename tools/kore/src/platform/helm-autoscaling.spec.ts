// Docs: docs/decisions/0047-autoscaling-metrics-server-then-keda.md
import { beforeEach, expect, test, vi } from "vitest";
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

const delivery = fakeComponent({ name: "kore-golden-path-delivery" });

test("with autoscaling on, kore-golden-path-delivery is given autoscaling=true, so the sync sets the autoscaler on each workload", () => {
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: { ...golden, autoscaling: true } },
    delivery,
  );
  const at = args.findIndex((arg) => arg === "autoscaling=true");
  expect(at).toBeGreaterThan(0);
  expect(args[at - 1]).toBe("--set");
});

test("with autoscaling off, kore-golden-path-delivery gets no autoscaling argument, so its values are unchanged", () => {
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: { ...golden, autoscaling: false } },
    delivery,
  );
  expect(args.some((arg) => arg.includes("autoscaling"))).toBe(false);
});

test("autoscaling is passed only to kore-golden-path-delivery, never to another component", () => {
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: { ...golden, autoscaling: true } },
    fakeComponent({ name: "kore-platform-config" }),
  );
  expect(args.some((arg) => arg.includes("autoscaling"))).toBe(false);
});
