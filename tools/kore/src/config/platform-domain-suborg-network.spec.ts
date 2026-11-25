// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import {
  clusterResolutionArgs,
  suborgNetworkArgs,
} from "./platform-cluster-resolution.js";
import { platformHelmArgs } from "./platform-domain.js";

// Issue 1552: platformHelmArgs hands the platform-apis chart whatever suborgNetworkArgs
// returns. This unit only splices that result in, so suborgNetworkArgs is mocked; its flags
// and service-range rules are tested in platform-cluster-resolution.spec.ts (ADR 0098).
vi.mock("./platform-cluster-resolution.js", () => ({
  clusterResolutionArgs: vi.fn(),
  suborgNetworkArgs: vi.fn(),
}));

const platform = {
  platform: { domain: "kore.internal", organizationId: "platform" },
  gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(clusterResolutionArgs).mockReturnValue([]);
});

test("platformHelmArgs passes the platform-apis chart the arguments suborgNetworkArgs returns, as a set-string pair", () => {
  vi.mocked(suborgNetworkArgs).mockReturnValue([
    "--set-string",
    "suborgNetwork.serviceCidr=10.43.0.0/16",
  ]);
  const environment = fakeEnvironment({ ...platform, provider: "managed" });
  expect(
    platformHelmArgs(environment, "kore-platform-apis").join(" "),
  ).toContain("--set-string suborgNetwork.serviceCidr=10.43.0.0/16");
});
