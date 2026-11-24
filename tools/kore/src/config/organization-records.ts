// Reads one environment's suborg records and checks them (ADR 0165): each file is one
// Organization, one level below the tenant root `platform`, named by its file. The
// rules are the Organization XRD's (platform-claims.ts, which the chart's drift test
// pins), plus the reserved names and the depth that need the other suborgs of the
// environment. Read-only: it reads the working tree and contacts no cluster.
// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SuborgRecord } from "./hostname-claims.js";
import { platformClaimErrors } from "./platform-claims.js";
import { platformPlan } from "./platform-domain.js";
import {
  reservedNameErrors,
  reservedSuborgNames,
  suborgDefaultZone,
} from "./suborg-names.js";
import type { Environment } from "./types.js";

const platformOrganization = "platform";
/** The XRD's non-root parent message, which a depth-two parent replaces with its own. */
const nonRootParent = `spec.parent: must be "${platformOrganization}", the tenant root`;

/** The environment's suborg records, one Organization per file (ADR 0165). */
export const organizationsDirectory = (environment: string): string =>
  `infra/environments/${environment}/organizations`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface OrganizationRecordInput {
  /** The record's repository path, which its messages begin with. */
  file: string;
  /** The file name without .json: the name the record must carry. */
  stem: string;
  manifest: unknown;
  /** The file names of the environment's suborg records: a parent that is one is depth two. */
  suborgs: ReadonlySet<string>;
  reserved: ReadonlySet<string>;
}

/** The record's kind and name, with the rules every record shares. */
function identityErrors(
  file: string,
  stem: string,
  manifest: Record<string, unknown>,
): string[] {
  if (manifest.kind !== "Organization") {
    const hint =
      manifest.kind === "Service"
        ? "; a Service belongs in the services directory"
        : "";
    return [
      `${file}.kind: must be Organization, the kind of a suborg record${hint}`,
    ];
  }
  const name = isRecord(manifest.metadata) ? manifest.metadata.name : undefined;
  if (name === platformOrganization) {
    return [
      `${file}: the platform organization is defined by the platform chart, not an overlay; this directory holds suborgs only`,
    ];
  }
  if (name !== stem) {
    return [
      `${file}: metadata.name "${String(name)}" must equal the file name "${stem}" without .json; rename the file or the name`,
    ];
  }
  return [];
}

/**
 * The errors of one suborg record. A parent that names another suborg of the
 * environment is refused as depth two, in place of the non-root parent message the
 * XRD rules give it: v1 allows one level below the root (ADR 0165).
 */
export function organizationRecordErrors(
  input: OrganizationRecordInput,
): string[] {
  const { file, stem, manifest, suborgs, reserved } = input;
  if (!isRecord(manifest)) {
    return [
      `${file}: the record must be an Organization object with apiVersion, kind and metadata.name`,
    ];
  }
  const identity = identityErrors(file, stem, manifest);
  if (identity.length > 0) {
    return identity;
  }
  const metadata = isRecord(manifest.metadata) ? manifest.metadata : {};
  const name = String(metadata.name);
  const spec = isRecord(manifest.spec) ? manifest.spec : {};
  const parent = typeof spec.parent === "string" ? spec.parent : undefined;
  const claim = platformClaimErrors([manifest]).map((error) =>
    error.replace(/^claims\[0\]/, file),
  );
  const depthTwo =
    parent !== undefined &&
    parent !== platformOrganization &&
    suborgs.has(parent);
  const errors = depthTwo
    ? claim.filter((error) => !error.includes(nonRootParent))
    : claim;
  if (depthTwo) {
    errors.push(
      `${file}.spec.parent: "${parent}" is a suborg, so this suborg would sit at depth two; v1 allows one level below platform, so set it to "${platformOrganization}"`,
    );
  }
  errors.push(...reservedNameErrors(name, file, reserved));
  return errors;
}

export interface OrganizationRecordCheck {
  /** The repository root. */
  root: string;
  environment: Environment;
  /** The catalog's component namespaces, which the reserved names are built from. */
  catalogNamespaces: readonly string[];
  /** The environment variables the run-time domain may come from; process.env unless a test passes one. */
  env?: NodeJS.ProcessEnv | undefined;
}

/** A suborg, with the default zone kore validate states for it. */
export interface OrganizationSummary {
  name: string;
  zone: string;
}

export interface OrganizationRecordReport {
  /** Problems that fail kore validate, each naming its file. */
  errors: string[];
  /** The environment's suborgs, each with its default zone. */
  organizations: OrganizationSummary[];
}

/** The `<suborg>.json` files of the directory, or a refusal of any other file. */
async function recordFiles(
  absolute: string,
  relative: string,
  errors: string[],
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
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
    if (!entry.endsWith(".json")) {
      errors.push(
        `${relative}/${entry}: the organizations directory holds <suborg>.json files only`,
      );
      continue;
    }
    files.set(entry.slice(0, -".json".length), `${relative}/${entry}`);
  }
  return files;
}

/** Each record parsed as strict JSON, or undefined with the failure recorded. */
async function parseRecord(
  root: string,
  file: string,
  errors: string[],
): Promise<unknown> {
  const text = await readFile(join(root, file), "utf8");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    errors.push(
      `${file}: the record must be strict JSON (JSON-compatible YAML): ${String(error)}`,
    );
    return undefined;
  }
}

/**
 * Checks the suborg records of one environment. An environment with no organizations
 * directory has none to check and reads no domain.
 */
export async function checkOrganizationRecords(
  check: OrganizationRecordCheck,
): Promise<OrganizationRecordReport> {
  const directory = organizationsDirectory(check.environment.name);
  const errors: string[] = [];
  const files = await recordFiles(
    join(check.root, directory),
    directory,
    errors,
  );
  const parsed = new Map<string, { file: string; manifest: unknown }>();
  for (const [stem, file] of files) {
    parsed.set(stem, {
      file,
      manifest: await parseRecord(check.root, file, errors),
    });
  }
  const reserved = reservedSuborgNames(check.catalogNamespaces);
  const suborgs = new Set(files.keys());
  const organizations: OrganizationSummary[] = [];
  for (const [stem, record] of parsed) {
    if (record.manifest === undefined) {
      continue;
    }
    const recordErrors = organizationRecordErrors({
      file: record.file,
      stem,
      manifest: record.manifest,
      suborgs,
      reserved,
    });
    errors.push(...recordErrors);
    if (recordErrors.length === 0) {
      organizations.push({
        name: stem,
        zone: suborgDefaultZone(
          stem,
          platformPlan(check.environment, check.env).domain,
        ),
      });
    }
  }
  return { errors: [...new Set(errors)], organizations };
}

/**
 * The suborg records of an environment by name, each a repository path: the names
 * the hostname claim rules read (ADR 0159). A directory that cannot be listed holds
 * no suborgs; the record check reports the directory's own problems.
 */
export async function suborgRecords(
  root: string,
  environment: Environment,
): Promise<SuborgRecord[]> {
  const directory = organizationsDirectory(environment.name);
  const files = await recordFiles(join(root, directory), directory, []);
  return [...files].map(([name, file]) => ({ name, file }));
}
