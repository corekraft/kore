// Docs: docs/decisions/0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md
import { beforeEach, expect, test, vi } from "vitest";
import { featureEnabled } from "./features.js";
import { fakeEnvironment } from "./config-support.js";
import {
  otlpByName,
  otlpHostname,
  platformHelmArgs,
} from "./platform-domain.js";

// Only the feature lookup is replaced: platformPlan lives in the same module as
// the functions under test, so it runs for real, and it is the one derivation.
vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  acmeDns01Flag: "acme-dns01",
  databaseRoutesFlag: "database-routes",
  otlpRouteFlag: "otlp-route",
  platformDnsFlag: "platform-dns",
  platformHostnameOwnershipFlag: "platform-hostname-ownership",
  platformSharedGatewayFlag: "platform-shared-gateway",
}));

const environment = fakeEnvironment({
  platform: { domain: "kore.internal", organizationId: "platform" },
  gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
});

/** Which flags are on; every other flag is off. */
function flagsOn(...on: string[]): void {
  vi.mocked(featureEnabled).mockImplementation((_environment, flag) =>
    on.includes(flag),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  flagsOn();
});

test("the OTLP name is otlp under the platform organization, from the environment's platform field", () => {
  expect(otlpHostname(environment)).toBe("otlp.platform.kore.internal");
});

test("OTLP is reached by name only while the otlp-route flag is on", () => {
  flagsOn("otlp-route");
  expect(otlpByName(environment)).toBe(true);
  expect(featureEnabled).toHaveBeenCalledWith(environment, "otlp-route");
  flagsOn();
  expect(otlpByName(environment)).toBe(false);
});

test("with otlp-route on the OTLP route chart is handed its name and the shared Gateway it attaches to", () => {
  flagsOn("otlp-route");
  expect(platformHelmArgs(environment, "kore-otlp-route")).toEqual([
    "--set-string",
    "otlpRoute.hostname=otlp.platform.kore.internal",
    "--set-string",
    "otlpRoute.gateway.name=kore-gateway",
    "--set-string",
    "otlpRoute.gateway.namespace=kore-system",
  ]);
});

test("with otlp-route off, and for any other component, no OTLP route argument is passed", () => {
  expect(platformHelmArgs(environment, "kore-otlp-route")).toEqual([]);
  flagsOn("otlp-route");
  expect(platformHelmArgs(environment, "otel-collector")).toEqual([]);
  expect(platformHelmArgs(environment, "oci-registry")).toEqual([]);
});
