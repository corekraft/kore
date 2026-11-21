import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import {
  backstageHostname,
  keycloakHostname,
  platformHelmArgs,
} from "./platform-domain.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md
// Docs: docs/decisions/0133-the-platform-owns-the-gateway-its-listeners-and-its-certificate-charts-own-routes-only.md

const sharedGateway = {
  platform: { domain: "kore.internal", organizationId: "platform" },
  gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
};
const sharedGatewayOn = fakeEnvironment({
  ...sharedGateway,
  features: { "platform-shared-gateway": true },
});
const sharedGatewayOff = fakeEnvironment({
  ...sharedGateway,
  features: { "platform-shared-gateway": false },
});

test("with platform-shared-gateway on the Keycloak chart is handed the organization's Keycloak host and the shared Gateway", () => {
  expect(platformHelmArgs(sharedGatewayOn, "kore-platform-keycloak")).toEqual([
    "--set-string",
    "keycloakHostname=keycloak.platform.kore.internal",
    "--set-string",
    "sharedGateway.name=kore-gateway",
    "--set-string",
    "sharedGateway.namespace=kore-system",
    "--set-string",
    "sharedGateway.domain=platform.kore.internal",
  ]);
});

test("with platform-shared-gateway off the Keycloak host stays under the bare platform domain, and no shared Gateway is handed over", () => {
  expect(platformHelmArgs(sharedGatewayOff, "kore-platform-keycloak")).toEqual([
    "--set-string",
    "keycloakHostname=keycloak.kore.internal",
  ]);
});

test("the portal is handed the same Keycloak host the Keycloak chart is, so its issuer names the host Keycloak serves", () => {
  const keycloakHost = (args: string[]) =>
    args.find((arg) => arg.startsWith("keycloakHostname="));
  for (const environment of [sharedGatewayOn, sharedGatewayOff]) {
    expect(
      keycloakHost(platformHelmArgs(environment, "kore-platform-backstage")),
    ).toBe(
      keycloakHost(platformHelmArgs(environment, "kore-platform-keycloak")),
    );
  }
});

test("keycloakHostname is the host Keycloak serves: under the platform organization while platform-shared-gateway is on, under the bare domain while it is off", () => {
  expect(keycloakHostname(sharedGatewayOn)).toBe(
    "keycloak.platform.kore.internal",
  );
  expect(keycloakHostname(sharedGatewayOff)).toBe("keycloak.kore.internal");
});

test("backstageHostname is the host the shared Gateway serves while platform-shared-gateway is on, and the bare domain while it is off, the name the portal's sign-in redirect and base URL take", () => {
  expect(backstageHostname(sharedGatewayOn)).toBe(
    "backstage.platform.kore.internal",
  );
  expect(backstageHostname(sharedGatewayOff)).toBe("backstage.kore.internal");
});

test("the portal is handed the one backstageHostname the helper derives, and no platform domain of its own", () => {
  for (const environment of [sharedGatewayOn, sharedGatewayOff]) {
    const args = platformHelmArgs(environment, "kore-platform-backstage");
    expect(args).toContain(
      `backstageHostname=${backstageHostname(environment)}`,
    );
    expect(args.some((arg) => arg.startsWith("platformDomain="))).toBe(false);
  }
});
