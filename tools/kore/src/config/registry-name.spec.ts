// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { beforeEach, expect, test, vi } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { featureEnabled } from "./features.js";
import { platformPlan } from "./platform-domain.js";
import {
  registryByName,
  registryHostname,
  registryRouteHelmArgs,
} from "./registry-name.js";

vi.mock("./features.js", () => ({
  featureEnabled: vi.fn(),
  registryByNameFlag: "registry-by-name",
}));
vi.mock("./platform-domain.js", () => ({ platformPlan: vi.fn() }));

const environment = fakeEnvironment({
  gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platformPlan).mockReturnValue({
    domain: "kore.internal",
    organizationId: "platform",
  });
});

test("the registry's name is registry under the platform organization and domain", () => {
  expect(registryHostname(environment)).toBe("registry.platform.kore.internal");
});

test("the registry is reached by name only while registry-by-name is on", () => {
  vi.mocked(featureEnabled).mockReturnValueOnce(true);
  expect(registryByName(environment)).toBe(true);
  expect(featureEnabled).toHaveBeenCalledWith(environment, "registry-by-name");
  vi.mocked(featureEnabled).mockReturnValueOnce(false);
  expect(registryByName(environment)).toBe(false);
});

test("the registry chart receives its name and the shared Gateway it attaches to while the flag is on", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(registryRouteHelmArgs(environment, "oci-registry")).toEqual([
    "--set-string",
    "registryRoute.hostname=registry.platform.kore.internal",
    "--set-string",
    "registryRoute.gateway.name=kore-gateway",
    "--set-string",
    "registryRoute.gateway.namespace=kore-system",
  ]);
});

test("with the flag off the registry chart receives nothing new", () => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  expect(registryRouteHelmArgs(environment, "oci-registry")).toEqual([]);
});

test("no other component receives the registry route values", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(registryRouteHelmArgs(environment, "kore-image-policy")).toEqual([]);
  expect(registryRouteHelmArgs(environment)).toEqual([]);
});
