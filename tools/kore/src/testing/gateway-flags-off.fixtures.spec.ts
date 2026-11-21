import { expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";

const loadRepository = vi.hoisted(() => vi.fn());
vi.mock("../config/index.js", () => ({ loadRepository }));

const { loadLocalGatewayFlagsOff, withGatewayFlagsOff, withPlatformDnsOn } =
  await import("./gateway-flags-off.fixtures.js");

const repository = {
  environment: {
    name: "local",
    features: {
      "ingress-agentgateway": true,
      "gateway-class-change-release": true,
      "gateway-rollback-order": true,
      "agentgateway-mesh-enrollment": true,
      "registry-by-name": true,
      "database-routes": true,
      "otlp-route": true,
      "platform-dns": true,
      "role-tokens": true,
    },
  },
} as unknown as Repository;

test("the gateway and traffic flags read off, so the istio path and no live-only route run", () => {
  const pinned = withGatewayFlagsOff(repository);

  expect(pinned.environment.features).toEqual({
    "ingress-agentgateway": false,
    "gateway-class-change-release": false,
    "gateway-rollback-order": false,
    "agentgateway-mesh-enrollment": false,
    "registry-by-name": false,
    "database-routes": false,
    "otlp-route": false,
    "platform-dns": false,
    "role-tokens": true,
  });
});

test("the repository it is given is left as it was", () => {
  withGatewayFlagsOff(repository);

  expect(repository.environment.features?.["ingress-agentgateway"]).toBe(true);
});

test("withPlatformDnsOn turns platform-dns on and leaves every other flag as it was", () => {
  const stated = withPlatformDnsOn(withGatewayFlagsOff(repository));

  expect(stated.environment.features).toEqual({
    "ingress-agentgateway": false,
    "gateway-class-change-release": false,
    "gateway-rollback-order": false,
    "agentgateway-mesh-enrollment": false,
    "registry-by-name": false,
    "database-routes": false,
    "otlp-route": false,
    "platform-dns": true,
    "role-tokens": true,
  });
});

test("withPlatformDnsOn leaves the repository it is given as it was", () => {
  const pinned = withGatewayFlagsOff(repository);
  withPlatformDnsOn(pinned);

  expect(pinned.environment.features?.["platform-dns"]).toBe(false);
});

test("the local repository loads with the gateway and traffic flags off", async () => {
  loadRepository.mockResolvedValue(repository);

  const loaded = await loadLocalGatewayFlagsOff();

  expect(loadRepository).toHaveBeenCalledWith("local");
  expect(loaded.environment.features?.["ingress-agentgateway"]).toBe(false);
});
