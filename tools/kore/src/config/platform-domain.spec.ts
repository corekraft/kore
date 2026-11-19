// Docs: docs/decisions/0042-organization-domains-by-delegation.md
import { expect, test } from "vitest";
import { fakeEnvironment, malformed } from "./config-support.js";
import {
  platformDomainErrors,
  platformHelmArgs,
  platformPlan,
} from "./platform-domain.js";
import type { Environment } from "./types.js";

const local = fakeEnvironment({
  platform: { domain: "kore.local", organizationId: "platform" },
});

function declared(platform: unknown): Environment {
  return fakeEnvironment({ platform: malformed(platform) });
}

test("the plan is the environment's one platform field, verbatim", () => {
  expect(platformPlan(local)).toEqual({
    domain: "kore.local",
    organizationId: "platform",
  });
});

test("an environment with no platform field is refused, naming the environment and the fix", () => {
  expect(() => platformPlan(fakeEnvironment({ name: "staging" }))).toThrow(
    "environment staging must declare platform.domain and platform.organizationId (for example kore.local and platform)",
  );
});

test("the defaults kore.local and platform pass validation", () => {
  expect(platformDomainErrors(local)).toEqual([]);
});

test("a domain with an uppercase letter is rejected with an example and the value read", () => {
  expect(
    platformDomainErrors(
      declared({ domain: "Kore.local", organizationId: "platform" }),
    ),
  ).toEqual([
    'platform.domain must be a lowercase DNS name of at least two labels, for example kore.local, in environment local, got "Kore.local"',
  ]);
});

test("a single-label domain, a domain with an empty label and a non-string are rejected", () => {
  for (const domain of [
    "kore",
    "kore..local",
    ".kore.local",
    8443,
    undefined,
  ]) {
    expect(
      platformDomainErrors(declared({ domain, organizationId: "platform" })),
    ).toEqual([
      `platform.domain must be a lowercase DNS name of at least two labels, for example kore.local, in environment local, got ${JSON.stringify(domain)}`,
    ]);
  }
});

test("a label longer than 63 characters is rejected", () => {
  const domain = `${"a".repeat(64)}.local`;
  expect(
    platformDomainErrors(declared({ domain, organizationId: "platform" })),
  ).toHaveLength(1);
});

test("a domain past 180 characters is rejected, so a 63-character service and the organization still fit 253", () => {
  const label = "a".repeat(60);
  const longest = [label, label, label.slice(0, 58)].join(".");
  expect(longest).toHaveLength(180);
  expect(
    platformDomainErrors(
      declared({ domain: longest, organizationId: "platform" }),
    ),
  ).toEqual([]);
  expect(
    platformDomainErrors(
      declared({ domain: `${longest}b`, organizationId: "platform" }),
    ),
  ).toEqual([
    `platform.domain must be at most 180 characters so <service>.<organizationId>.<domain> fits 253, in environment local, got ${longest.length + 1}`,
  ]);
});

test("an organization identifier must be one lowercase DNS label", () => {
  for (const organizationId of ["Platform", "plat.form", "-platform", "", 7]) {
    expect(
      platformDomainErrors(declared({ domain: "kore.local", organizationId })),
    ).toEqual([
      `platform.organizationId must be one lowercase DNS label, for example platform, in environment local, got ${JSON.stringify(organizationId)}`,
    ]);
  }
});

test("a missing platform field is one error that names both members", () => {
  expect(platformDomainErrors(fakeEnvironment({ name: "staging" }))).toEqual([
    "environment staging must declare platform.domain and platform.organizationId (for example kore.local and platform)",
  ]);
});

test("a bad domain and a bad identifier are both reported", () => {
  expect(
    platformDomainErrors(
      declared({ domain: "kore", organizationId: "Platform" }),
    ),
  ).toHaveLength(2);
});

test("each chart that read a hand-set domain is handed it as a derived value", () => {
  expect(platformHelmArgs(local, "kore-platform-apis")).toEqual([
    "--set-string",
    "platformDomain=kore.local",
  ]);
  expect(platformHelmArgs(local, "kore-platform-keycloak")).toEqual([
    "--set-string",
    "platformDomain=kore.local",
  ]);
  expect(platformHelmArgs(local, "kore-platform-backstage")).toEqual([
    "--set-string",
    "platformDomain=kore.local",
  ]);
  expect(platformHelmArgs(local, "kore-platform-config")).toEqual([
    "--set-string",
    "gateway.hostname=kore.local",
    "--set-string",
    "gateway.platformHostname=*.platform.kore.local",
  ]);
  expect(platformHelmArgs(local, "kore-local-tls")).toEqual([
    "--set-string",
    "gateway.hostname=kore.local",
  ]);
});

test("the shared Gateway's wildcard is the platform organization's names under the one platform domain", () => {
  const internal = fakeEnvironment({
    platform: { domain: "kore.internal", organizationId: "platform" },
  });
  expect(platformHelmArgs(internal, "kore-platform-config")).toEqual([
    "--set-string",
    "gateway.hostname=kore.internal",
    "--set-string",
    "gateway.platformHostname=*.platform.kore.internal",
  ]);
});

test("the platform DNS component is handed the platform domain as its zone", () => {
  expect(platformHelmArgs(local, "kore-platform-dns")).toEqual([
    "--set-string",
    "zone=kore.local",
  ]);
});

test("a component that reads no platform domain is handed none", () => {
  expect(platformHelmArgs(local, "cert-manager")).toEqual([]);
  expect(platformHelmArgs(local, "kore-config-delivery")).toEqual([]);
});

test("the derived value follows the environment's field, not a default", () => {
  expect(
    platformHelmArgs(
      fakeEnvironment({
        platform: { domain: "platform.example.com", organizationId: "acme" },
      }),
      "kore-platform-apis",
    ),
  ).toEqual(["--set-string", "platformDomain=platform.example.com"]);
});

const sharedGateway = {
  platform: { domain: "kore.local", organizationId: "platform" },
  gateway: { namespace: "kore-system", name: "kore-gateway", port: 8443 },
};
const sharedGatewayOn = fakeEnvironment({
  ...sharedGateway,
  features: { "platform-shared-gateway": true },
});

test("with platform-shared-gateway on the portal and the golden-path delivery are handed the shared Gateway and the organization's domain", () => {
  const values = (prefix: string) => [
    "--set-string",
    `${prefix}sharedGateway.name=kore-gateway`,
    "--set-string",
    `${prefix}sharedGateway.namespace=kore-system`,
    "--set-string",
    `${prefix}sharedGateway.domain=platform.kore.local`,
  ];
  expect(platformHelmArgs(sharedGatewayOn, "kore-platform-backstage")).toEqual([
    "--set-string",
    "platformDomain=kore.local",
    ...values(""),
  ]);
  expect(
    platformHelmArgs(sharedGatewayOn, "kore-golden-path-delivery"),
  ).toEqual(values("ingress."));
});

test("with platform-shared-gateway off or omitted no shared Gateway value is handed to any chart", () => {
  for (const off of [
    fakeEnvironment({
      ...sharedGateway,
      features: { "platform-shared-gateway": false },
    }),
    fakeEnvironment(sharedGateway),
  ]) {
    expect(platformHelmArgs(off, "kore-platform-backstage")).toEqual([
      "--set-string",
      "platformDomain=kore.local",
    ]);
    expect(platformHelmArgs(off, "kore-golden-path-delivery")).toEqual([]);
  }
});

test("the shared Gateway's domain follows the environment's organization and domain", () => {
  const moved = fakeEnvironment({
    ...sharedGateway,
    platform: { domain: "kore.internal", organizationId: "acme" },
    features: { "platform-shared-gateway": true },
  });
  expect(platformHelmArgs(moved, "kore-golden-path-delivery")).toContain(
    "ingress.sharedGateway.domain=acme.kore.internal",
  );
});

const dnsOn = fakeEnvironment({
  ...sharedGateway,
  features: { "platform-dns": true },
});

test("with platform-dns on the portal is handed the CA bundle its pods trust, and the DNS component the Gateway whose Service it rewrites to", () => {
  expect(platformHelmArgs(dnsOn, "kore-platform-backstage")).toEqual([
    "--set-string",
    "platformDomain=kore.local",
    "--set-string",
    "localCa.configMap=kore-local-ca",
  ]);
  expect(platformHelmArgs(dnsOn, "kore-platform-dns")).toEqual([
    "--set-string",
    "zone=kore.local",
    "--set-string",
    "gateway.name=kore-gateway",
    "--set-string",
    "gateway.namespace=kore-system",
  ]);
});

test("with platform-dns off or omitted the portal is handed no CA bundle", () => {
  for (const off of [
    fakeEnvironment({ ...sharedGateway, features: { "platform-dns": false } }),
    fakeEnvironment(sharedGateway),
  ]) {
    expect(platformHelmArgs(off, "kore-platform-backstage")).toEqual([
      "--set-string",
      "platformDomain=kore.local",
    ]);
  }
});
