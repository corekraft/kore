import { expect, test } from "vitest";
import type { SchemaNode } from "./schema-subset.js";
import {
  componentCrossErrors,
  duplicateNameErrors,
  organizationChangeErrors,
  releaseFileErrors,
  specFileErrors,
} from "./app-record-rules.js";

const file = "infra/environments/local/services/leads.json";
const releaseFile = "infra/environments/local/services/leads.release.json";
const digest = `sha256:${"a".repeat(64)}`;
const commit = "b".repeat(40);

/** The Service XRD's spec, as the rules see it: the chart's shape, trimmed to the fields these tests touch. */
const xrdSpec: SchemaNode = {
  type: "object",
  required: ["organization", "environments"],
  properties: {
    organization: { type: "string", enum: ["platform"] },
    environments: { type: "array", items: { type: "string" } },
    repository: { type: "string" },
    path: { type: "string" },
    gateway: {
      type: "string",
      enum: ["internal", "external"],
      default: "internal",
    },
    components: {
      type: "object",
      minProperties: 1,
      description: "frontend, bff or both: a service with neither is refused",
      properties: {
        frontend: { $ref: "#/$defs/component" },
        bff: { $ref: "#/$defs/component" },
      },
    },
  },
  $defs: {
    component: {
      type: "object",
      properties: {
        resources: {
          type: "object",
          properties: {
            requests: {
              type: "object",
              properties: {
                cpu: { type: "string" },
                memory: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

/** The release schema shape: the real file is read by the integration spec. */
const releaseSchema: SchemaNode = {
  type: "object",
  required: ["apiVersion", "kind", "metadata", "spec"],
  properties: {
    apiVersion: { const: "platform.kore.dev/v1alpha1" },
    kind: { const: "ServiceRelease" },
    metadata: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
    spec: {
      type: "object",
      required: ["commit", "components"],
      properties: {
        commit: {
          type: "string",
          pattern: "^[0-9a-f]{40}$",
          description: "the 40-character lowercase hex source commit",
        },
        components: {
          type: "object",
          minProperties: 1,
          description: "frontend, bff or both",
          properties: {
            frontend: { $ref: "#/$defs/component" },
            bff: { $ref: "#/$defs/component" },
          },
        },
      },
    },
  },
  $defs: {
    component: {
      type: "object",
      required: ["digest"],
      properties: {
        digest: {
          type: "string",
          pattern: "^sha256:[0-9a-f]{64}$",
          description:
            "the image digest, sha256 then 64 lowercase hex characters",
        },
        attestation: { type: "string" },
      },
    },
  },
};

function spec(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name: "leads" },
    spec: {
      organization: "platform",
      environments: ["local"],
      components: { frontend: { resources: { requests: { cpu: "100m" } } } },
      ...overrides,
    },
  };
}

function release(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "ServiceRelease",
    metadata: { name: "leads" },
    spec: {
      commit,
      components: { frontend: { digest } },
      ...overrides,
    },
  };
}

function specErrors(manifest: unknown, stem = "leads") {
  return specFileErrors({ file, stem, manifest, xrdSpec });
}

function releaseErrors(manifest: unknown, stem = "leads") {
  return releaseFileErrors({
    file: releaseFile,
    stem,
    manifest,
    releaseSchema,
  });
}

test("a spec file with a frontend component and the required fields has no errors", () => {
  expect(specErrors(spec())).toEqual([]);
});

test("a spec file without components is refused, naming frontend and bff", () => {
  const manifest = spec();
  delete (manifest.spec as Record<string, unknown>).components;
  expect(specErrors(manifest)).toEqual([
    `${file}: spec.components is required: declare frontend, bff or both (a service with neither is refused)`,
  ]);
});

test("a spec file with an empty components object is refused, naming frontend and bff", () => {
  expect(specErrors(spec({ components: {} }))).toEqual([
    `${file}: spec.components must have at least 1 field (frontend, bff or both: a service with neither is refused)`,
  ]);
});

test("a digest in a spec file fails, saying only the release file carries it", () => {
  expect(specErrors(spec({ components: { frontend: { digest } } }))).toEqual([
    `${file}: spec.components.frontend.digest belongs to the release file, not the spec file: only leads.release.json carries image digests, the source commit, attestations and flag state (ADR 0166, ADR 0169)`,
  ]);
});

test("flag state in a spec file fails, saying only the release file carries it", () => {
  const manifest = spec();
  (manifest as Record<string, unknown>).flags = { "leads.new-checkout": false };
  expect(specErrors(manifest)).toEqual([
    `${file}: flags belongs to the release file, not the spec file: only leads.release.json carries image digests, the source commit, attestations and flag state (ADR 0166, ADR 0169)`,
  ]);
});

test("a source commit in a spec file fails, saying only the release file carries it", () => {
  expect(specErrors(spec({ commit }))).toEqual([
    `${file}: spec.commit belongs to the release file, not the spec file: only leads.release.json carries image digests, the source commit, attestations and flag state (ADR 0166, ADR 0169)`,
  ]);
});

test("an unknown field in a spec file is refused, naming the field and the fields that are allowed", () => {
  expect(specErrors(spec({ replicas: 3 }))).toEqual([
    `${file}: spec.replicas is not a field of this record; the fields here are organization, environments, repository, path, gateway, components`,
  ]);
});

test("a spec file whose name is not its file name fails, naming both", () => {
  expect(specErrors(spec(), "leads-api")).toEqual([
    `${file}: metadata.name leads must equal the file name leads-api, so the record is named after its file`,
  ]);
});

test("a spec file must be a Service, not another kind", () => {
  const manifest = { ...spec(), kind: "ServiceRelease" };
  expect(specErrors(manifest)).toEqual([`${file}: kind must be "Service"`]);
});

test("a service name that breaks the cluster's name rules fails, with the rule it breaks", () => {
  const messages = specErrors(
    { ...spec(), metadata: { name: "9leads" } },
    "9leads",
  );
  expect(messages.join("\n")).toContain("must start with a lowercase letter");
});

test("a release file with a digest, a commit and no spec fields has no errors", () => {
  expect(releaseErrors(release())).toEqual([]);
});

test("flag state in a release file fails as an unknown field, saying flag state is not in the release file", () => {
  expect(
    releaseErrors(release({ flags: { "leads.new-checkout": false } })),
  ).toEqual([
    `${releaseFile}: spec.flags: flag state is not in the release file; the platform holds it in the separate per-app state file (ADR 0169, #1571)`,
  ]);
});

test("a spec field in a release file fails, saying only the spec file carries it", () => {
  expect(releaseErrors(release({ organization: "platform" }))).toEqual([
    `${releaseFile}: spec.organization belongs to the spec file, not the release file: only leads.json carries the service's fields (ADR 0166)`,
  ]);
});

test("a malformed digest fails, naming the field and the expected pattern", () => {
  expect(
    releaseErrors(
      release({ components: { frontend: { digest: "sha256:abc" } } }),
    ),
  ).toEqual([
    `${releaseFile}: spec.components.frontend.digest must match ^sha256:[0-9a-f]{64}$ (the image digest, sha256 then 64 lowercase hex characters)`,
  ]);
});

test("a source commit that is not 40 lowercase hex characters fails, naming the field", () => {
  expect(releaseErrors(release({ commit: "ABC" }))).toEqual([
    `${releaseFile}: spec.commit must match ^[0-9a-f]{40}$ (the 40-character lowercase hex source commit)`,
  ]);
});

test("a release must carry at least one component", () => {
  expect(releaseErrors(release({ components: {} }))).toEqual([
    `${releaseFile}: spec.components must have at least 1 field (frontend, bff or both)`,
  ]);
});

test("a release whose name is not its file name fails", () => {
  expect(
    releaseErrors({ ...release(), metadata: { name: "leads-api" } }, "leads"),
  ).toEqual([
    `${releaseFile}: metadata.name leads-api must equal the file name leads, so the record is named after its file`,
  ]);
});

test("a release component the spec does not declare fails, naming the component and the spec file", () => {
  expect(
    componentCrossErrors({
      releaseFile,
      specFile: file,
      release: release({ components: { bff: { digest } } }).spec.components,
      spec: spec().spec.components,
    }),
  ).toEqual([
    `${releaseFile}: spec.components.bff is not declared in ${file}; declare the component in the spec file before a release carries its digest`,
  ]);
});

test("a spec component with no digest in the release is fine: a new service before its first bump", () => {
  expect(
    componentCrossErrors({
      releaseFile,
      specFile: file,
      release: release().spec.components,
      spec: {
        frontend: { resources: { requests: { cpu: "100m" } } },
        bff: { resources: { requests: { cpu: "100m" } } },
      },
    }),
  ).toEqual([]);
});

test("a name used by two records fails, listing both paths", () => {
  expect(
    duplicateNameErrors([
      { name: "leads", file: "infra/services/leads.yaml" },
      { name: "leads", file: file },
    ]),
  ).toEqual([
    `infra/services/leads.yaml and ${file} both declare the service leads: a service name is unique across the cluster (ADR 0166); rename one of them`,
  ]);
});

test("a changed organization on an existing service fails, naming the service, both values and the base", () => {
  expect(
    organizationChangeErrors({
      file,
      name: "leads",
      base: "platform",
      current: "sales",
      ref: "origin/main",
    }),
  ).toEqual([
    `${file}: organization is immutable: leads declares organization platform at origin/main but sets sales; a new suborg means a new service name (ADR 0166)`,
  ]);
});

test("an unchanged organization passes the immutability check", () => {
  expect(
    organizationChangeErrors({
      file,
      name: "leads",
      base: "platform",
      current: "platform",
      ref: "origin/main",
    }),
  ).toEqual([]);
});
