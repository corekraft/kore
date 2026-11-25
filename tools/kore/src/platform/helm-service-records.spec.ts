// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
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
  applicationImageArgs: vi.fn(),
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

test("with serviceRecords on, kore-golden-path-delivery is given it, so the sync also applies the Service records", () => {
  vi.mocked(featureHelmArgs).mockReturnValue([]);
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: { ...golden, serviceRecords: true } },
    fakeComponent({ name: "kore-golden-path-delivery" }),
  );
  const at = args.indexOf("serviceRecords=true");
  expect(at).toBeGreaterThan(0);
  expect(args[at - 1]).toBe("--set");
});

test("with serviceRecords off, kore-golden-path-delivery gets no serviceRecords argument, so its values are unchanged", () => {
  vi.mocked(featureHelmArgs).mockReturnValue([]);
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: { ...golden, serviceRecords: false } },
    fakeComponent({ name: "kore-golden-path-delivery" }),
  );
  expect(args.some((arg) => arg.includes("serviceRecords"))).toBe(false);
});

test("serviceRecords is passed only to kore-golden-path-delivery, never to another component", () => {
  vi.mocked(featureHelmArgs).mockReturnValue([]);
  const args = helmUpgradeArgs(
    { ...repository, goldenPathDelivery: { ...golden, serviceRecords: true } },
    fakeComponent({ name: "kore-platform-config" }),
  );
  expect(args.some((arg) => arg.includes("serviceRecords"))).toBe(false);
});
