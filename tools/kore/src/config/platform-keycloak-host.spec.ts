import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { platformHelmArgs } from "./platform-domain.js";

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
