// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
import { expect, test } from "vitest";
import { organizationRecordErrors } from "./organization-records.js";
import { reservedSuborgNames } from "./suborg-names.js";

const file = "infra/environments/local/organizations/api.json";

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

const reserved = reservedSuborgNames(["argocd", "keycloak"]);

function check(
  manifest: unknown,
  stem = "api",
  suborgs: readonly string[] = [],
): string[] {
  return organizationRecordErrors({
    file,
    stem,
    manifest,
    suborgs: new Set(suborgs),
    reserved,
  });
}

test("a fixture suborg one level below platform, with its quota, passes", () => {
  expect(check(suborg)).toEqual([]);
});

test("a record that is not an Organization is refused, naming the kind it must be", () => {
  expect(check({ ...suborg, kind: "Service" })).toEqual([
    `${file}.kind: must be Organization, the kind of a suborg record; a Service belongs in the services directory`,
  ]);
});

test("the platform organization is the chart's, so a platform record in this directory is refused", () => {
  expect(
    check(
      {
        ...suborg,
        metadata: { name: "platform" },
        spec: { tenant: "platform" },
      },
      "platform",
    ),
  ).toEqual([
    `${file}: the platform organization is defined by the platform chart, not an overlay; this directory holds suborgs only`,
  ]);
});

test("a metadata.name that is not the file name stem names both and the fix", () => {
  expect(check(suborg, "payments")).toEqual([
    `${file}: metadata.name "api" must equal the file name "payments" without .json; rename the file or the name`,
  ]);
});

test("a reserved suborg name is refused, naming the field and the reason", () => {
  const manifest = {
    ...suborg,
    metadata: { name: "keycloak" },
  };
  expect(check(manifest, "keycloak")).toEqual([
    `${file}.metadata.name: "keycloak" is a reserved name: it is a platform namespace, default, internal, www or reference; choose another name, for example "keycloak-team"`,
  ]);
});

test("a suborg whose parent is another suborg of this environment is refused as depth two", () => {
  const manifest = {
    ...suborg,
    metadata: { name: "leads" },
    spec: { ...suborg.spec, parent: "api" },
  };
  expect(check(manifest, "leads", ["api", "leads"])).toEqual([
    `${file}.spec.parent: "api" is a suborg, so this suborg would sit at depth two; v1 allows one level below platform, so set it to "platform"`,
  ]);
});

test("a parent that is neither platform nor a suborg of this environment is a non-root parent", () => {
  const manifest = { ...suborg, spec: { ...suborg.spec, parent: "payments" } };
  expect(check(manifest)).toEqual([
    `${file}.spec.parent: must be "platform", the tenant root: v1 places a suborg one level below it; set it to "platform"`,
  ]);
});
