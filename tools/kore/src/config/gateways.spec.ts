// Docs: docs/decisions/0042-organization-domains-by-delegation.md
import { expect, test } from "vitest";
import { fakeEnvironment, malformed } from "./config-support.js";
import {
  externalGateway,
  gatewayErrors,
  internalDomain,
  internalGateway,
} from "./gateways.js";
import type { Environment } from "./types.js";

const platform = { domain: "example.com", organizationId: "platform" };
const legacy = { namespace: "kore-system", name: "kore-gateway", port: 443 };
const internal = { ...legacy, issuer: "kore-local-ca" };
const external = {
  namespace: "kore-system",
  name: "kore-gateway-external",
  port: 443,
  issuer: "acme-production",
};

/** An environment named staging with the fields a test sets; a raw shape, as an overlay may declare it. */
function staging(fields: Record<string, unknown>): Environment {
  return fakeEnvironment(
    malformed<Partial<Environment>>({
      name: "staging",
      platform,
      ...fields,
    }),
  );
}

const neither =
  "environment staging must declare gateways.internal (or the single gateway field), for example kore-gateway in kore-system";

test("the internal Gateway is the declared gateways.internal entry", () => {
  expect(internalGateway(staging({ gateways: { internal } }))).toEqual(
    internal,
  );
});

test("an environment that declares only the single gateway field keeps it as the internal Gateway", () => {
  expect(internalGateway(staging({ gateway: legacy }))).toEqual(legacy);
});

test("an environment with no Gateway is refused, naming the fields and an example", () => {
  expect(() => internalGateway(staging({}))).toThrow(neither);
});

test("the external Gateway is absent unless gateways.external is declared", () => {
  expect(externalGateway(staging({ gateways: { internal } }))).toBeUndefined();
  expect(
    externalGateway(staging({ gateways: { internal, external } })),
  ).toEqual(external);
});

test("the internal domain is the platform domain when none is declared", () => {
  expect(internalDomain(staging({}))).toBe("example.com");
});

test("a declared internal domain is the internal domain", () => {
  expect(
    internalDomain(
      staging({
        platform: { ...platform, internalDomain: "internal.example.com" },
      }),
    ),
  ).toBe("internal.example.com");
});

test("a legacy-only or internal-only environment has no validation errors", () => {
  expect(gatewayErrors(staging({ gateway: legacy }))).toEqual([]);
  expect(gatewayErrors(staging({ gateways: { internal } }))).toEqual([]);
});

test("an external Gateway under the internal domain has no validation errors", () => {
  expect(
    gatewayErrors(
      staging({
        platform: { ...platform, internalDomain: "internal.example.com" },
        gateways: { internal, external },
      }),
    ),
  ).toEqual([]);
});

test("an external Gateway with no internal domain is refused, naming the field and the fix", () => {
  expect(gatewayErrors(staging({ gateways: { internal, external } }))).toEqual([
    "platform.internalDomain is required when gateways.external is declared: set it to internal.example.com in environment staging",
  ]);
});

test("an internal domain that is not internal. under the platform domain is refused with the value read", () => {
  for (const internalDomainValue of ["example.com", "internal.example.net"]) {
    expect(
      gatewayErrors(
        staging({
          platform: { ...platform, internalDomain: internalDomainValue },
          gateways: { internal, external },
        }),
      ),
    ).toEqual([
      `platform.internalDomain must be internal.example.com when gateways.external is declared, in environment staging, got "${internalDomainValue}"`,
    ]);
  }
});

test("an external Gateway with no internal Gateway is refused, naming the entry to add", () => {
  expect(
    gatewayErrors(
      staging({
        platform: { ...platform, internalDomain: "internal.example.com" },
        gateways: { external },
      }),
    ),
  ).toEqual([
    "gateways.internal is required when gateways is declared; add gateways.internal with name, namespace, port and issuer (for example kore-gateway in kore-system on port 443 with issuer kore-local-ca) in environment staging",
  ]);
});

test("a declared internal domain with no external Gateway must equal the platform domain", () => {
  expect(
    gatewayErrors(
      staging({
        platform: { ...platform, internalDomain: "internal.example.com" },
        gateways: { internal },
      }),
    ),
  ).toEqual([
    'platform.internalDomain must equal platform.domain (example.com) when gateways.external is not declared, in environment staging, got "internal.example.com"; remove platform.internalDomain to use the platform domain',
  ]);
});

test("the single gateway field and gateways.internal must name the same Gateway", () => {
  expect(
    gatewayErrors(
      staging({
        gateway: { ...legacy, port: 8443 },
        gateways: { internal },
      }),
    ),
  ).toEqual([
    "gateway and gateways.internal name different Gateways in environment staging: make gateways.internal match gateway (name, namespace and port), or remove gateway",
  ]);
});

test("an environment with neither the single gateway field nor gateways.internal is refused", () => {
  expect(gatewayErrors(staging({}))).toEqual([neither]);
});

test("an entry with a bad port, namespace, name or issuer is refused, naming the field", () => {
  expect(
    gatewayErrors(
      staging({
        gateways: {
          internal: {
            namespace: "Kore_System",
            name: "kore-gateway",
            port: 0,
            issuer: "kore-local-ca",
          },
        },
      }),
    ),
  ).toEqual([
    'gateways.internal.namespace must be a lowercase DNS label, for example kore-system, in environment staging, got "Kore_System"',
    "gateways.internal.port must be a whole number from 1 to 65535, for example 443, in environment staging, got 0",
  ]);
  expect(
    gatewayErrors(
      staging({
        gateways: {
          internal: { ...legacy, name: "Kore Gateway", issuer: undefined },
        },
      }),
    ),
  ).toEqual([
    'gateways.internal.name must be a lowercase DNS label, for example kore-gateway, in environment staging, got "Kore Gateway"',
    "gateways.internal.issuer must be a lowercase DNS label naming the certificate issuer, for example kore-local-ca, in environment staging, got undefined",
  ]);
});

test("an external Gateway with the internal Gateway's name is refused", () => {
  expect(
    gatewayErrors(
      staging({
        platform: { ...platform, internalDomain: "internal.example.com" },
        gateways: { internal, external: { ...external, name: "kore-gateway" } },
      }),
    ),
  ).toEqual([
    "gateways.external.name must differ from gateways.internal.name (kore-gateway) in environment staging",
  ]);
});
