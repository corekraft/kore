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

const suborg = {
  apiVersion: "platform.kore.dev/v1alpha1",
  kind: "Organization",
  metadata: { name: "api" },
  spec: {
    tenant: "platform",
    parent: "platform",
    quota: {
      requests: { cpu: "8", memory: "16Gi" },
      pods: 50,
      storage: "100Gi",
    },
  },
};

test("a suborg one level below platform, with a full quota, passes", () => {
  expect(platformClaimErrors([suborg])).toEqual([]);
});

test("a suborg without a parent names spec.parent as required, and says to set platform", () => {
  const { parent: _parent, ...spec } = suborg.spec;
  expect(platformClaimErrors([{ ...suborg, spec }])).toEqual([
    'claims[0].spec.parent: is required for a suborg; set it to "platform", the tenant root',
  ]);
});

test("a suborg whose parent is not the tenant root names spec.parent and the depth rule", () => {
  expect(
    platformClaimErrors([
      { ...suborg, spec: { ...suborg.spec, parent: "payments" } },
    ]),
  ).toEqual([
    'claims[0].spec.parent: must be "platform", the tenant root: v1 places a suborg one level below it; set it to "platform"',
  ]);
});

test("the platform organization has no parent, so a parent on it is refused", () => {
  expect(
    platformClaimErrors([
      { ...organization, spec: { tenant: "platform", parent: "platform" } },
    ]),
  ).toEqual([
    "claims[0].spec.parent: the platform organization is the tenant root and has no parent; remove spec.parent",
  ]);
});

test("a suborg without a quota names spec.quota as required, with no default", () => {
  const { quota: _quota, ...spec } = suborg.spec;
  expect(platformClaimErrors([{ ...suborg, spec }])).toEqual([
    "claims[0].spec.quota: is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage",
  ]);
});

test("a suborg quota names each field that is missing or malformed, and the expected form", () => {
  expect(
    platformClaimErrors([
      {
        ...suborg,
        spec: {
          ...suborg.spec,
          quota: { requests: { cpu: "lots" }, pods: 0, storage: "100G" },
        },
      },
    ]),
  ).toEqual([
    'claims[0].spec.quota.requests.cpu: must be a CPU quantity such as "8" or "500m"',
    'claims[0].spec.quota.requests.memory: is required; set a memory quantity with a Mi, Gi or Ti suffix, such as "16Gi"',
    "claims[0].spec.quota.pods: must be a whole number of at least 1, for example 50",
    'claims[0].spec.quota.storage: must be a storage quantity with a Gi or Ti suffix, such as "100Gi"',
  ]);
});

test("a suborg quota with an unknown field names it and lists the fields allowed", () => {
  expect(
    platformClaimErrors([
      {
        ...suborg,
        spec: { ...suborg.spec, quota: { ...suborg.spec.quota, gpus: 1 } },
      },
    ]),
  ).toEqual([
    "claims[0].spec.quota.gpus: is not a quota field; the fields are requests, pods and storage",
  ]);
});

test("a suborg name over 54 characters names the limit that keeps <suborg>--preview within 63", () => {
  const name = "a".repeat(55);
  expect(platformClaimErrors([{ ...suborg, metadata: { name } }])).toEqual([
    `claims[0].metadata.name: must be at most 54 characters, so <suborg>--preview fits 63; shorten it, for example "${"a".repeat(54)}"`,
  ]);
});

test("a suborg name with a double hyphen names the field and the fix", () => {
  expect(
    platformClaimErrors([{ ...suborg, metadata: { name: "pay--team" } }]),
  ).toEqual([
    'claims[0].metadata.name: must not contain a double hyphen: the suborg namespace is <suborg> and its preview is <suborg>--preview; rename it, for example "pay-team"',
  ]);
});

test("a suborg name that is not a DNS label names the field and the fix", () => {
  expect(
    platformClaimErrors([{ ...suborg, metadata: { name: "Pay_Team" } }]),
  ).toEqual([
    'claims[0].metadata.name: must be a single DNS label (lowercase letters, digits and hyphens, at most 63 characters, no dots); rename it, for example "pay-team"',
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
      { ...organization, spec: { tenant: "platform", parent: "payments" } },
      { ...service, spec: { organization: "acme", environments: [] } },
    ]),
  ).toEqual([
    "claims[0].spec.parent: the platform organization is the tenant root and has no parent; remove spec.parent",
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

test("a Service name at the 51-character cap passes, and its longest derived label, the Argo Application, fits 63 characters", () => {
  const name = `s${"a".repeat(50)}`;
  expect(name.length).toBe(51);
  expect(`golden-path-${name}`.length).toBe(63);
  expect(`${name}-frontend`.length).toBeLessThanOrEqual(63);
  expect(platformClaimErrors([{ ...service, metadata: { name } }])).toEqual([]);
});

test("a Service name one over the cap is rejected, naming the rule and the 51-character limit", () => {
  const name = `s${"a".repeat(51)}`;
  const oneEnvironment = {
    ...service,
    spec: { ...service.spec, environments: ["local"] },
  };
  expect(
    platformClaimErrors([{ ...oneEnvironment, metadata: { name } }]),
  ).toEqual([
    `claims[0].metadata.name: must be at most 51 characters, because the longest derived label, the Argo Application golden-path-<service>, adds 12 characters to fit 63; shorten it, for example "${name.slice(0, 51)}"`,
  ]);
});

test("a Service name that starts with a digit is rejected, naming the leading-letter rule", () => {
  expect(
    platformClaimErrors([{ ...service, metadata: { name: "1shop" } }]),
  ).toEqual([
    'claims[0].metadata.name: must start with a lowercase letter (a Kubernetes Service name cannot start with a digit); rename it, for example "s1shop"',
  ]);
});
