// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// Spec #1612, issue #1629: the Organization API is handed the internal domain its internal zones are built from.
import { expect, test } from "vitest";
import { fakeEnvironment } from "./config-support.js";
import { internalDomainOf, platformHelmArgs } from "./platform-domain.js";

const internal = {
  namespace: "kore-system",
  name: "kore-gateway",
  port: 443,
  issuer: "kore-local-ca",
};
const external = {
  namespace: "kore-system",
  name: "kore-gateway-external",
  port: 443,
  issuer: "acme-production",
};

test("with platform-hostname-ownership on and an external Gateway the Organization API is handed internal.<domain> as its internal domain", () => {
  const split = fakeEnvironment({
    platform: { domain: "example.com", organizationId: "platform" },
    gateways: { internal, external },
    features: { "platform-hostname-ownership": true },
  });
  expect(platformHelmArgs(split, "kore-platform-apis")).toEqual([
    "--set-string",
    "platformDomain=example.com",
    "--set-string",
    "platformOrganizationId=platform",
    "--set-string",
    "platformInternalDomain=internal.example.com",
  ]);
});

test("the internal domain is the platform domain on a one-domain platform and internal.<domain> with an external Gateway", () => {
  const platform = { domain: "example.com", organizationId: "platform" };
  expect(
    internalDomainOf(fakeEnvironment({ platform, gateways: { internal } })),
  ).toBe("example.com");
  expect(
    internalDomainOf(
      fakeEnvironment({ platform, gateways: { internal, external } }),
    ),
  ).toBe("internal.example.com");
});

test("on a managed environment the internal domain follows the run-time platform domain, as the platform domain does", () => {
  const environment = fakeEnvironment({
    provider: "managed",
    platform: { domain: "example.com", organizationId: "platform" },
    gateways: { internal, external },
  });
  expect(
    internalDomainOf(environment, {
      KORE_PLATFORM_DOMAIN: "example.org",
    } as NodeJS.ProcessEnv),
  ).toBe("internal.example.org");
});
