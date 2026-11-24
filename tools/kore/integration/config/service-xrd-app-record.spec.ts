// The Service XRD carries the app record fields (ADR 0166), and the ServiceRelease
// schema carries no flag state (ADR 0169). The chart is rendered with helm and the
// XRD read with yq, so the proof is the chart's own output and no cluster is touched.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const repository = new URL("../../../../", import.meta.url);
const chart = "infra/charts/platform-apis";
const releaseSchemaPath = "infra/catalog/schemas/service-release.schema.json";

type Schema = {
  type?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  minProperties?: number;
  default?: unknown;
  enum?: unknown[];
  items?: Schema;
  $defs?: Record<string, Schema>;
};

/** The Service XRD's v1alpha1 spec schema, from the chart's own rendered output. */
function serviceSpec(): Schema {
  const rendered = execFileSync(
    "helm",
    [
      "template",
      "platform-apis",
      new URL(chart, repository).pathname,
      "--set",
      "platformDomain=kore.internal",
    ],
    { encoding: "utf8" },
  );
  const text = execFileSync(
    "yq",
    [
      "--output-format=json",
      'select(.kind == "CompositeResourceDefinition" and .metadata.name == "services.platform.kore.dev") | .spec.versions[] | select(.name == "v1alpha1") | .schema.openAPIV3Schema.properties.spec',
    ],
    { encoding: "utf8", input: rendered },
  );
  return JSON.parse(text) as Schema;
}

test("the Service XRD still requires exactly organization and environments, so every app record field is optional", () => {
  expect(serviceSpec().required).toEqual(["organization", "environments"]);
});

test("the app record fields exist in the Service XRD, and none of them is required", () => {
  const properties = Object.keys(serviceSpec().properties ?? {});
  expect(properties).toEqual(
    expect.arrayContaining([
      "organization",
      "environments",
      "repository",
      "path",
      "components",
      "gateway",
      "hostnames",
      "backup",
      "allowFrom",
      "secrets",
    ]),
  );
});

test("organization is a label-safe name of at most 54 characters, not an enum, and the environment bounds stay", () => {
  const spec = serviceSpec();
  expect(spec.properties?.organization?.enum).toBeUndefined();
  expect(spec.properties?.organization).toMatchObject({
    type: "string",
    maxLength: 54,
    pattern: "^[a-z0-9]([a-z0-9]|-[a-z0-9])*$",
  });
  expect(spec.properties?.environments).toMatchObject({
    minItems: 1,
    maxItems: 16,
  });
});

test("components declares frontend and bff, each optional, and at least one of them", () => {
  const components = serviceSpec().properties?.components;
  expect(components?.minProperties).toBe(1);
  expect(Object.keys(components?.properties ?? {})).toEqual([
    "frontend",
    "bff",
  ]);
  expect(components?.required).toBeUndefined();
});

test("each component takes resource requests, a memory limit and an autoscaler, and nothing else: no digest, no attestation, no flag state", () => {
  const frontend = serviceSpec().properties?.components?.properties?.frontend;
  expect(Object.keys(frontend?.properties ?? {})).toEqual([
    "resources",
    "autoscaling",
  ]);
  const resources = frontend?.properties?.resources?.properties;
  expect(Object.keys(resources?.requests?.properties ?? {})).toEqual([
    "cpu",
    "memory",
    "ephemeralStorage",
  ]);
  expect(Object.keys(resources?.limits?.properties ?? {})).toEqual(["memory"]);
});

test("gateway defaults to internal and takes only internal or external", () => {
  const gateway = serviceSpec().properties?.gateway;
  expect(gateway?.default).toBe("internal");
  expect(gateway?.enum).toEqual(["internal", "external"]);
});

test("soak is an optional object with exactly duration and minRequests, and no CRD default", () => {
  const soak = serviceSpec().properties?.soak;
  expect(soak?.type).toBe("object");
  expect(soak?.additionalProperties).toBe(false);
  expect(soak?.required).toBeUndefined();
  expect(soak?.default).toBeUndefined();
  expect(Object.keys(soak?.properties ?? {})).toEqual([
    "duration",
    "minRequests",
  ]);
});

test("soak.duration is a whole number of minutes, hours or days with no CRD default, and soak.minRequests is a whole number of at least one", () => {
  const soak = serviceSpec().properties?.soak;
  expect(soak?.properties?.duration).toMatchObject({
    type: "string",
    pattern: "^[1-9][0-9]*[mhd]$",
  });
  expect(soak?.properties?.duration?.default).toBeUndefined();
  expect(soak?.properties?.minRequests).toMatchObject({
    type: "integer",
    minimum: 1,
  });
  expect(soak?.properties?.minRequests?.default).toBeUndefined();
});

test("the spec has no release-only field: no digest, source commit, attestation or flag state", () => {
  const properties = Object.keys(serviceSpec().properties ?? {});
  for (const forbidden of ["commit", "digest", "attestation", "flags"]) {
    expect(properties).not.toContain(forbidden);
  }
});

test("the ServiceRelease schema carries no flags map and closes every object", async () => {
  const release = JSON.parse(
    await readFile(new URL(releaseSchemaPath, repository), "utf8"),
  ) as Schema & {
    properties: { spec: Schema; metadata: Schema };
  };
  expect(release.additionalProperties).toBe(false);
  expect(release.properties.spec.properties).not.toHaveProperty("flags");
  expect(release.properties.spec.additionalProperties).toBe(false);
  expect(release.properties.metadata.additionalProperties).toBe(false);
  expect(release.$defs?.component?.additionalProperties).toBe(false);
  expect(release.$defs?.component?.properties).not.toHaveProperty("flags");
});
