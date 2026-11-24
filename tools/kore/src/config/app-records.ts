// Reads one environment's app records and checks them (ADR 0166): the spec file
// against the Service schema of the platform-apis chart, the release file against
// infra/catalog/schemas, the cross-file rules, name uniqueness across the cluster
// and the immutable organization against a base ref (app-record-base.ts).
// Read-only: it reads the working tree, the chart and git, and contacts no cluster.
// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Runner } from "../runtime/index.js";
import {
  componentCrossErrors,
  duplicateNameErrors,
  rejectedDigestErrors,
  releaseFileErrors,
  specFileErrors,
  type NameEntry,
} from "./app-record-rules.js";
import {
  immutabilityReport,
  type ImmutabilityRecord,
} from "./app-record-base.js";
import { registrationPaths } from "./service-registrations.js";
import type { SchemaNode } from "./schema-subset.js";

/** The chart file that holds the Service XRD; the schema is read from it, never copied. */
export const serviceXrdPath =
  "infra/charts/platform-apis/templates/service-xrd.yaml";
/** The ServiceRelease JSON Schema in the catalog schemas (ADR 0166). */
export const serviceReleaseSchemaPath =
  "infra/catalog/schemas/service-release.schema.json";

export interface AppRecordCheck {
  /** The repository root. */
  root: string;
  /** The environment whose services directory is checked: one environment is one cluster. */
  environment: string;
  runner: Runner;
  /** The pinned yq version, named in the message when yq is missing. */
  yqVersion: string;
  /** The base ref for the organization check; unset compares against origin/main. */
  recordBase?: string | undefined;
}

export interface AppRecordReport {
  /** Problems that fail kore validate, each naming its file. */
  errors: string[];
  /** Checks that could not run; they never fail validation. */
  warnings: string[];
}

/** A record file read and parsed; its path is a repository path. */
interface ParsedRecord {
  file: string;
  manifest: unknown;
}

/** The records of one services directory, by service name, each a repository path. */
interface RecordFiles {
  specs: Map<string, string>;
  releases: Map<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const releaseSuffix = ".release.json";
const specSuffix = ".json";

/** The services directory of an environment, as a repository path. */
export const servicesDirectory = (environment: string): string =>
  `infra/environments/${environment}/services`;

/** The spec and release files of the services directory; other files are refused. */
async function recordFiles(
  absolute: string,
  relative: string,
  errors: string[],
): Promise<RecordFiles> {
  const files: RecordFiles = { specs: new Map(), releases: new Map() };
  let entries: string[];
  try {
    entries = await readdir(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return files;
    }
    throw error;
  }
  for (const entry of entries.sort()) {
    if (entry.startsWith(".")) {
      continue;
    }
    const file = `${relative}/${entry}`;
    if (entry.endsWith(releaseSuffix)) {
      files.releases.set(entry.slice(0, -releaseSuffix.length), file);
    } else if (entry.endsWith(specSuffix)) {
      files.specs.set(entry.slice(0, -specSuffix.length), file);
    } else {
      errors.push(
        `${file}: the services directory holds <service>.json (the spec file) and <service>.release.json (the release file) only`,
      );
    }
  }
  return files;
}

/** A record read and parsed, or undefined with the failure recorded. */
async function readRecord(
  root: string,
  file: string,
  errors: string[],
): Promise<ParsedRecord | undefined> {
  const text = await readFile(join(root, file), "utf8");
  try {
    return { file, manifest: JSON.parse(text) as unknown };
  } catch (error) {
    errors.push(
      `${file}: the record must be strict JSON (JSON-compatible YAML): ${String(error)}`,
    );
    return undefined;
  }
}

/**
 * The Service schema's spec node, read from the chart with yq through the
 * injected runner (the way the chart CRDs are read). A missing yq fails with the
 * pinned version and the mise command that installs it.
 */
async function serviceSpecSchema(check: AppRecordCheck): Promise<SchemaNode> {
  const { root, runner, yqVersion } = check;
  let text: string;
  try {
    ({ stdout: text } = await runner.run(
      "yq",
      [
        "--output-format=json",
        '.spec.versions[] | select(.name == "v1alpha1") | .schema.openAPIV3Schema.properties.spec',
        join(root, serviceXrdPath),
      ],
      { capture: true, cwd: root },
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `kore validate reads the Service schema from ${serviceXrdPath} with yq, and yq is not installed: install yq ${yqVersion} with mise (mise install yq@${yqVersion}), then rerun`,
      );
    }
    throw error;
  }
  const spec: unknown = JSON.parse(text);
  if (!isRecord(spec)) {
    throw new Error(
      `${serviceXrdPath} has no v1alpha1 spec schema; the Service XRD must keep its v1alpha1 version`,
    );
  }
  return spec as SchemaNode;
}

/** The spec files that parse, by name, each checked against the chart's Service schema. */
async function checkSpecs(
  check: AppRecordCheck,
  specs: Map<string, string>,
  errors: string[],
): Promise<Map<string, ParsedRecord>> {
  const parsed = new Map<string, ParsedRecord>();
  if (specs.size === 0) {
    return parsed;
  }
  const xrdSpec = await serviceSpecSchema(check);
  for (const [stem, file] of specs) {
    const record = await readRecord(check.root, file, errors);
    if (record === undefined) {
      continue;
    }
    parsed.set(stem, record);
    errors.push(
      ...specFileErrors({ file, stem, manifest: record.manifest, xrdSpec }),
    );
  }
  return parsed;
}

/** Each release file against its schema, and against the components of its spec. */
async function checkReleases(
  check: AppRecordCheck,
  files: RecordFiles,
  parsedSpecs: Map<string, ParsedRecord>,
  errors: string[],
): Promise<void> {
  if (files.releases.size === 0) {
    return;
  }
  const releaseSchema = JSON.parse(
    await readFile(join(check.root, serviceReleaseSchemaPath), "utf8"),
  ) as SchemaNode;
  for (const [stem, file] of files.releases) {
    const record = await readRecord(check.root, file, errors);
    if (record === undefined) {
      continue;
    }
    errors.push(
      ...releaseFileErrors({
        file,
        stem,
        manifest: record.manifest,
        releaseSchema,
      }),
    );
    errors.push(
      ...rejectedDigestErrors({
        file,
        components: componentsOf(record.manifest),
      }),
    );
    const spec = parsedSpecs.get(stem);
    if (spec !== undefined) {
      errors.push(
        ...componentCrossErrors({
          releaseFile: file,
          specFile: spec.file,
          release: componentsOf(record.manifest),
          spec: componentsOf(spec.manifest),
        }),
      );
    } else if (!files.specs.has(stem)) {
      errors.push(
        `${file}: a release file needs its spec file ${stem}.json beside it in ${servicesDirectory(check.environment)}`,
      );
    }
  }
}

function componentsOf(manifest: unknown): unknown {
  const spec = isRecord(manifest) ? manifest.spec : undefined;
  return isRecord(spec) ? spec.components : undefined;
}

function organizationOf(manifest: unknown): string | undefined {
  const spec = isRecord(manifest) ? manifest.spec : undefined;
  const organization = isRecord(spec) ? spec.organization : undefined;
  return typeof organization === "string" ? organization : undefined;
}

/**
 * Uniqueness across the cluster: this environment's services and the legacy
 * registrations, whatever their environments lists say (ADR 0166).
 */
async function nameErrors(
  root: string,
  specs: Map<string, string>,
): Promise<string[]> {
  const entries: NameEntry[] = [...specs].map(([name, file]) => ({
    name,
    file,
  }));
  for (const [name, file] of await registrationPaths(root)) {
    entries.push({ name, file });
  }
  return duplicateNameErrors(entries);
}

/**
 * Checks the app records of one environment. Errors fail kore validate; warnings
 * name a check that could not run. An environment with no services directory and
 * no --record-base has nothing to check and reads no schema.
 */
export async function checkAppRecords(
  check: AppRecordCheck,
): Promise<AppRecordReport> {
  const directory = servicesDirectory(check.environment);
  const errors: string[] = [];
  const files = await recordFiles(
    join(check.root, directory),
    directory,
    errors,
  );
  const parsedSpecs = await checkSpecs(check, files.specs, errors);
  await checkReleases(check, files, parsedSpecs, errors);
  errors.push(...(await nameErrors(check.root, files.specs)));
  const warnings: string[] = [];
  if (check.recordBase !== undefined || files.specs.size > 0) {
    const records: ImmutabilityRecord[] = [];
    for (const [stem, record] of parsedSpecs) {
      const organization = organizationOf(record.manifest);
      if (organization !== undefined) {
        records.push({ stem, file: record.file, organization });
      }
    }
    const report = await immutabilityReport({
      root: check.root,
      runner: check.runner,
      recordBase: check.recordBase,
      records,
    });
    errors.push(...report.errors);
    warnings.push(...report.warnings);
  }
  return {
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  };
}
