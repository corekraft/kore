// Docs: docs/decisions/0042-organization-domains-by-delegation.md
import { expect, test } from "vitest";
import { platformClaimErrors } from "./platform-claims.js";

const organization = {
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "Organization",
  metadata: { name: "platform" },
  spec: { tenant: "payments" },
};

const service = {
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "Service",
  metadata: { name: "checkout" },
  spec: { organization: "platform", environments: ["local", "managed"] },
};

test("a valid Organization and Service claim pass with no errors", () => {
  expect(platformClaimErrors([organization, service])).toEqual([]);
});

test("the claims document must be an array, and says how to fix it", () => {
  expect(platformClaimErrors(organization)).toEqual([
    "claims must be a JSON array of Organization and Service objects; wrap the claim in [ ]",
  ]);
});

test("a claim of another kind is rejected, naming the two accepted kinds", () => {
  expect(platformClaimErrors([{ ...organization, kind: "Database" }])).toEqual([
    "claims[0].kind: Database is not a platform claim; use Organization or Service",
  ]);
});

test("a claim outside the platform.kore.dev/v1alpha1 API is rejected", () => {
  expect(platformClaimErrors([{ ...organization, apiVersion: "v1" }])).toEqual([
    "claims[0].apiVersion: must be platform.kore.dev/v1alpha1; set it to that value",
  ]);
});

test("an Organization that is not named platform names the field and the fix", () => {
  expect(
    platformClaimErrors([{ ...organization, metadata: { name: "acme" } }]),
  ).toEqual([
    'claims[0].metadata.name: only the platform organization is supported; set it to "platform"',
  ]);
});

test("an Organization tenant that is not a DNS label names the field and the fix", () => {
  expect(
    platformClaimErrors([{ ...organization, spec: { tenant: "Pay_Ments" } }]),
  ).toEqual([
    'claims[0].spec.tenant: must be a lowercase DNS label of letters, digits and hyphens (at most 63); rename it, for example "payments"',
  ]);
});

test("an Organization without a tenant names spec.tenant as required", () => {
  expect(platformClaimErrors([{ ...organization, spec: {} }])).toEqual([
    'claims[0].spec.tenant: is required; set it to the organization\'s tenant name, for example "payments"',
  ]);
});

test("a Service in an organization other than platform is rejected", () => {
  expect(
    platformClaimErrors([
      { ...service, spec: { ...service.spec, organization: "acme" } },
    ]),
  ).toEqual([
    'claims[0].spec.organization: must be "platform"; the Service API serves only the platform organization',
  ]);
});

test("a Service name with a double hyphen or a reserved prefix names the field and the fix", () => {
  expect(
    platformClaimErrors([{ ...service, metadata: { name: "a--b" } }]),
  ).toEqual([
    'claims[0].metadata.name: must not contain a double hyphen, because the namespace is <service>--<environment>; rename it, for example "a-b"',
  ]);
  expect(
    platformClaimErrors([{ ...service, metadata: { name: "kube-shop" } }]),
  ).toEqual([
    'claims[0].metadata.name: must not start with kube- or kore-, the reserved prefixes; rename it, for example "shop"',
  ]);
});

test("a Service with no environments, or a repeated one, names spec.environments and the fix", () => {
  expect(
    platformClaimErrors([
      { ...service, spec: { organization: "platform", environments: [] } },
    ]),
  ).toEqual([
    'claims[0].spec.environments: needs at least one environment; add one, for example "local"',
  ]);
  expect(
    platformClaimErrors([
      {
        ...service,
        spec: { organization: "platform", environments: ["local", "local"] },
      },
    ]),
  ).toEqual([
    'claims[0].spec.environments: must not repeat "local"; remove the duplicate',
  ]);
});

test("a Service environment whose namespace would exceed 63 characters names the length and the fix", () => {
  const long = "a".repeat(40);
  const name = "b".repeat(30);
  expect(
    platformClaimErrors([
      {
        ...service,
        metadata: { name },
        spec: { organization: "platform", environments: [long] },
      },
    ]),
  ).toEqual([
    `claims[0].spec.environments: the namespace ${name}--${long} is longer than 63 characters; shorten metadata.name or the environment name`,
  ]);
});

test("every error is reported, each with the index of the claim it belongs to", () => {
  expect(
    platformClaimErrors([
      { ...organization, metadata: { name: "acme" } },
      { ...service, spec: { organization: "acme", environments: [] } },
    ]),
  ).toEqual([
    'claims[0].metadata.name: only the platform organization is supported; set it to "platform"',
    'claims[1].spec.organization: must be "platform"; the Service API serves only the platform organization',
    'claims[1].spec.environments: needs at least one environment; add one, for example "local"',
  ]);
});

test("a Service name with a dot is not a single DNS label, and the fix keeps the default host valid", () => {
  expect(
    platformClaimErrors([{ ...service, metadata: { name: "shop.eu" } }]),
  ).toEqual([
    'claims[0].metadata.name: must be a single DNS label (lowercase letters, digits and hyphens, at most 63 characters, no dots): the default host is <service>.<organization>.<platform domain>; rename it, for example "shop-eu"',
  ]);
});
