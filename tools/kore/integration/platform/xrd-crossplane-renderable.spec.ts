// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
// Crossplane renders an XRD's schema into a CRD and refuses a schema node that has both
// `properties` and `additionalProperties` ("additionalProperties and properties are
// mutual exclusive", an EstablishComposite event on the #2033 live run). The XRD object
// still reads Established=True, so the cluster CRD silently keeps the old fields. The
// chart is rendered with helm and read with yq, so the proof is the chart's own output
// and no cluster is touched. `kore validate` closes every object that has `properties`
// itself (schema-subset.ts), so a node does not need `additionalProperties: false`.
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

const chart = new URL("../../../../infra/charts/platform-apis", import.meta.url)
  .pathname;

interface Node {
  properties?: Record<string, Node>;
  additionalProperties?: unknown;
  items?: Node;
}

interface Xrd {
  metadata: { name: string };
  spec: {
    versions: { name: string; schema: { openAPIV3Schema: Node } }[];
  };
}

/** The XRDs the chart renders with the given extra Helm arguments, one per document. */
function xrds(...extra: string[]): Xrd[] {
  const rendered = execFileSync(
    "helm",
    [
      "template",
      "platform-apis",
      chart,
      "--set-string",
      "platformDomain=kore.internal",
      ...extra,
    ],
    { encoding: "utf8" },
  );
  const lines = execFileSync(
    "yq",
    [
      "--output-format=json",
      "--indent=0",
      'select(.kind == "CompositeResourceDefinition")',
    ],
    { encoding: "utf8", input: rendered },
  );
  return lines
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Xrd);
}

/** The paths of every node that sets `additionalProperties` beside `properties`. */
function mixedNodes(node: Node, path: string): string[] {
  const here =
    node.properties !== undefined && node.additionalProperties !== undefined
      ? [path]
      : [];
  const children = Object.entries(node.properties ?? {}).flatMap(
    ([name, child]) => mixedNodes(child, `${path}.${name}`),
  );
  const items =
    node.items === undefined ? [] : mixedNodes(node.items, `${path}[]`);
  return [...here, ...children, ...items];
}

const featureSets: Record<string, string[]> = {
  "the defaults": [],
  "every schema-shaping feature on": [
    "--set",
    "platformOrganizationId=platform",
    "--set",
    "features.platform-hostname-ownership=true",
    "--set",
    "features.suborg-tenancy=true",
    "--set",
    "features.platform-shared-gateway=true",
  ],
};

for (const [name, extra] of Object.entries(featureSets)) {
  test(`no XRD the platform-apis chart renders sets additionalProperties beside properties, with ${name}`, () => {
    const rendered = xrds(...extra);
    expect(rendered.map((xrd) => xrd.metadata.name).sort()).toEqual([
      "organizations.platform.kore.dev",
      "services.platform.kore.dev",
    ]);
    const mixed = rendered.flatMap((xrd) =>
      xrd.spec.versions.flatMap((version) =>
        mixedNodes(
          version.schema.openAPIV3Schema,
          `${xrd.metadata.name}/${version.name}`,
        ),
      ),
    );
    expect(mixed).toEqual([]);
  });
}

test("the walk finds a node that has both, so the test above can fail", () => {
  const schema: Node = {
    properties: {
      spec: {
        properties: { quota: { properties: {}, additionalProperties: false } },
      },
    },
  };
  expect(mixedNodes(schema, "x")).toEqual(["x.spec.quota"]);
});
