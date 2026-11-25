// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
import { beforeEach, expect, test, vi } from "vitest";
import { applicationImageArgs } from "../config/index.js";
import { helmUpgradeArgs } from "./helm.js";
import { configAnswers } from "./helm-support.js";
import { fakeComponent, fakeRepository } from "./platform-support.js";

// Issue 1556: while suborg-image-policy is on, the image-policy release takes the app
// records' images (applicationImageArgs decides which release and when).

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

beforeEach(configAnswers);

test("a release takes the application image arguments for its own name, from the same repository, last", () => {
  const repository = fakeRepository();
  vi.mocked(applicationImageArgs).mockReturnValue([
    "--set-json",
    "applicationImages=[]",
  ]);
  const component = fakeComponent({ name: "kore-image-policy" });
  expect(helmUpgradeArgs(repository, component).slice(-2)).toEqual([
    "--set-json",
    "applicationImages=[]",
  ]);
  expect(vi.mocked(applicationImageArgs).mock.calls).toEqual([
    [repository, "kore-image-policy"],
  ]);
});
