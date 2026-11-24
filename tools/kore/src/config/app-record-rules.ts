// The rules of one app record: the spec file (the Service kind, reviewed by people)
// and the release file (ServiceRelease, written by the platform), per ADR 0166.
// Pure: the caller reads the files, the chart's schema and the base ref, and passes
// them in. The record reader is app-records.ts.
// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
// Docs: docs/decisions/0169-an-app-declares-its-flags-and-the-platform-holds-their-state.md

import { serviceNameErrors } from "./platform-claims.js";
import { schemaErrors, type SchemaNode } from "./schema-subset.js";

/** The apiVersion both record kinds carry (ADR 0166). */
export const serviceApiVersion = "platform.kore.dev/v1alpha1";

/** Fields only the release file carries: image digests, the source commit, attestations and flag state. */
const releaseOnlyFields = new Set(["commit", "digest", "attestation", "flags"]);

/** Fields only the spec file carries: the service's own fields, never a digest or flag state. */
const specOnlyFields = new Set([
  "organization",
  "repository",
  "path",
  "environments",
  "gateway",
  "hostnames",
  "backup",
  "allowFrom",
  "secrets",
  "resources",
]);

type Manifest = Record<string, unknown>;

const isRecord = (value: unknown): value is Manifest =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The manifest envelope a spec file must have: the Service kind around the XRD's
 * spec. The spec's own $defs travel with it, so a $ref inside the spec resolves.
 */
function specEnvelope(spec: SchemaNode): SchemaNode {
  return {
    type: "object",
    required: ["apiVersion", "kind", "metadata", "spec"],
    ...(spec.$defs === undefined ? {} : { $defs: spec.$defs }),
    properties: {
      apiVersion: { const: serviceApiVersion },
      kind: { const: "Service" },
      metadata: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
      spec,
    },
  };
}

/** A key the spec file may not carry, named by what carries it instead. */
function specUnknownField(stem: string) {
  return (path: string, key: string): string | undefined =>
    releaseOnlyFields.has(key)
      ? `${path} belongs to the release file, not the spec file: only ${stem}.release.json carries image digests, the source commit, attestations and flag state (ADR 0166, ADR 0169)`
      : undefined;
}

/** A key the release file may not carry: flag state has its own file, a spec field belongs to the spec file. */
function releaseUnknownField(stem: string) {
  return (path: string, key: string): string | undefined => {
    if (key === "flags") {
      return `${path}: flag state is not in the release file; the platform holds it in the separate per-app state file (ADR 0169, #1571)`;
    }
    if (specOnlyFields.has(key)) {
      return `${path} belongs to the spec file, not the release file: only ${stem}.json carries the service's fields (ADR 0166)`;
    }
    return undefined;
  };
}

/** The name in metadata, when the record has one as a string. */
function recordName(manifest: unknown): string | undefined {
  const name =
    isRecord(manifest) && isRecord(manifest.metadata)
      ? manifest.metadata.name
      : undefined;
  return typeof name === "string" ? name : undefined;
}

/**
 * Errors every record shares: the name must be its file name, and it must pass the
 * Service name rules of the XRD. Messages are prefixed with the file.
 */
function nameErrors(file: string, stem: string, manifest: unknown): string[] {
  const name = recordName(manifest);
  if (name === undefined) {
    return [];
  }
  const errors: string[] = [];
  if (name !== stem) {
    errors.push(
      `${file}: metadata.name ${name} must equal the file name ${stem}, so the record is named after its file`,
    );
  }
  return [...errors, ...serviceNameErrors(name, file)];
}

export interface SpecFileInput {
  /** The spec file's repository path, for the messages. */
  file: string;
  /** The file name without .json: the service name the record must carry. */
  stem: string;
  /** The parsed file. */
  manifest: unknown;
  /** The spec of the chart's Service XRD, read by the caller and never copied here. */
  xrdSpec: SchemaNode;
}

/**
 * The problems of one spec file: its shape against the chart's Service schema, the
 * release-only fields it must not carry, and its name. A new-shape spec declares
 * components, so a service with neither a frontend nor a bff is refused.
 */
export function specFileErrors(input: SpecFileInput): string[] {
  const { file, stem, manifest, xrdSpec } = input;
  const errors = schemaErrors(specEnvelope(xrdSpec), manifest, "", {
    unknownField: specUnknownField(stem),
  }).map((message) => `${file}: ${message}`);
  const spec = isRecord(manifest) ? manifest.spec : undefined;
  if (isRecord(spec) && spec.components === undefined) {
    errors.push(
      `${file}: spec.components is required: declare frontend, bff or both (a service with neither is refused)`,
    );
  }
  return [...errors, ...nameErrors(file, stem, manifest)];
}

export interface ReleaseFileInput {
  file: string;
  stem: string;
  manifest: unknown;
  /** The ServiceRelease JSON Schema from infra/catalog/schemas, read by the caller. */
  releaseSchema: SchemaNode;
}

/**
 * The problems of one release file against its own schema (no unknown field, no
 * spec field, no flag state, a well-formed digest and commit), and its name.
 */
export function releaseFileErrors(input: ReleaseFileInput): string[] {
  const { file, stem, manifest, releaseSchema } = input;
  const errors = schemaErrors(releaseSchema, manifest, "", {
    unknownField: releaseUnknownField(stem),
  }).map((message) => `${file}: ${message}`);
  return [...errors, ...nameErrors(file, stem, manifest)];
}

export interface ComponentCrossInput {
  releaseFile: string;
  specFile: string;
  /** The release's spec.components. */
  release: unknown;
  /** The spec's spec.components. */
  spec: unknown;
}

/**
 * A release may carry a digest only for a component its spec declares. A spec
 * component with no release digest is fine: a new service before its first bump.
 */
export function componentCrossErrors(input: ComponentCrossInput): string[] {
  const { releaseFile, specFile, release, spec } = input;
  const declared = isRecord(spec) ? spec : {};
  const released = isRecord(release) ? release : {};
  return Object.keys(released)
    .filter((key) => !(key in declared))
    .map(
      (key) =>
        `${releaseFile}: spec.components.${key} is not declared in ${specFile}; declare the component in the spec file before a release carries its digest`,
    );
}

export interface RejectedDigestInput {
  /** The release file, as a repository path, for the messages. */
  file: string;
  /** The release's spec.components. */
  components: unknown;
}

/**
 * A component's rejected list holds digests the platform must not deploy again
 * (ADR 0172), so it never holds the digest that component deploys. The rule is per
 * component: another component may reject a digest this one deploys.
 */
export function rejectedDigestErrors(input: RejectedDigestInput): string[] {
  const { file, components } = input;
  if (!isRecord(components)) {
    return [];
  }
  return Object.entries(components).flatMap(([name, component]) => {
    if (!isRecord(component) || !Array.isArray(component.rejected)) {
      return [];
    }
    if (!component.rejected.includes(component.digest)) {
      return [];
    }
    return [
      `${file}: spec.components.${name}.rejected lists the current digest ${String(component.digest)}; a rejected digest must differ from the one the release deploys (ADR 0172)`,
    ];
  });
}

export interface NameEntry {
  name: string;
  /** The file that declares the name, as a repository path. */
  file: string;
}

/**
 * A service name is unique across the cluster in v1 (ADR 0166). Each later
 * declaration of a name fails, naming both files.
 */
export function duplicateNameErrors(entries: readonly NameEntry[]): string[] {
  const owners = new Map<string, string>();
  const errors: string[] = [];
  for (const { name, file } of entries) {
    const owner = owners.get(name);
    if (owner === undefined) {
      owners.set(name, file);
    } else {
      errors.push(
        `${owner} and ${file} both declare the service ${name}: a service name is unique across the cluster (ADR 0166); rename one of them`,
      );
    }
  }
  return errors;
}

export interface OrganizationInput {
  file: string;
  /** The service name, for the message. */
  name: string;
  /** The organization at the base ref; undefined when the service is new there. */
  base: string | undefined;
  /** The organization in the working tree. */
  current: string;
  /** The base ref the value was read from, for the message. */
  ref: string;
}

/**
 * An existing service's organization is immutable: a new suborg means a new
 * service name (ADR 0166). A service absent at the base is new and passes.
 */
export function organizationChangeErrors(input: OrganizationInput): string[] {
  const { file, name, base, current, ref } = input;
  if (base === undefined || base === current) {
    return [];
  }
  return [
    `${file}: organization is immutable: ${name} declares organization ${base} at ${ref} but sets ${current}; a new suborg means a new service name (ADR 0166)`,
  ];
}
