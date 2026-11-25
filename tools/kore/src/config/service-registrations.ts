import { readdir, readFile } from "node:fs/promises";
import { loadForeignCertificateNames } from "./foreign-certificates.js";
import {
  acmeDns01Flag,
  featureEnabled,
  platformPortalFlag,
} from "./features.js";
import { platformPlan } from "./platform-domain.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0115-scope-the-organization-and-service-platform-apis-to-the-cluster.md
// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md

/**
 * The legacy directory, in git, that holds one Service registration per file. It
 * stays until the contract step of ADR 0166 drops it.
 */
export const serviceRegistrationsDirectory = "infra/services";

/**
 * The services directory of one environment overlay (ADR 0166). Its
 * <service>.json spec files are registrations beside the legacy directory; its
 * <service>.release.json files carry no name and are not registrations.
 */
const environmentServicesDirectory = (environment: string): string =>
  `infra/environments/${environment}/services`;

/** The chart that renders one dashboard and one alert group per registered Service. */
const serviceObservabilityComponent = "kore-service-observability";

// The same rule the service-observability chart's values schema applies, so every
// derived name passes the chart.
const dnsLabel = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const maxNameLength = 61;

function nameErrors(name: string): string | undefined {
  if (
    name.length > maxNameLength ||
    !dnsLabel.test(name) ||
    name.includes("--")
  ) {
    return `the registered Service name ${name} must be a DNS label of ${maxNameLength} characters or fewer, lowercase letters, digits and single hyphens`;
  }
  return undefined;
}

/**
 * The name one registration file declares, or a failure that names the file. The
 * same rules apply to a legacy registration and to a spec file in an overlay.
 * `relative` is the file's path in the repository.
 */
async function registrationName(
  root: string,
  relative: string,
): Promise<string> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(`${root}/${relative}`, "utf8"));
  } catch (error) {
    throw new Error(
      `${relative}: registrations must use JSON-compatible YAML: ${String(error)}`,
    );
  }
  const record = (
    typeof manifest === "object" && manifest !== null ? manifest : {}
  ) as {
    kind?: unknown;
    metadata?: { name?: unknown };
    limits?: unknown;
    spec?: { limits?: unknown };
  };
  if (record.kind !== "Service") {
    throw new Error(
      `${relative}: a registration must be a Service manifest (kind Service)`,
    );
  }
  if (record.limits !== undefined || record.spec?.limits !== undefined) {
    throw new Error(
      `${relative}: a limits field is platform-owned: the external Gateway's limits are set by the platform in the environment overlay, so a service record cannot tune, lower or raise them (ADR 0160)`,
    );
  }
  const name = record.metadata?.name;
  if (typeof name !== "string") {
    throw new Error(
      `${relative}: the Service manifest needs metadata.name, a DNS label`,
    );
  }
  const error = nameErrors(name);
  if (error !== undefined) {
    throw new Error(`${relative}: ${error}`);
  }
  return name;
}

/** The entries of a directory that pass keep, sorted; none when the directory is absent. */
async function entriesOf(
  directory: string,
  keep: (entry: string) => boolean,
): Promise<string[]> {
  try {
    return (await readdir(directory)).filter(keep).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * The legacy registrations by name, each keyed to its repository path. A name
 * declared by two legacy files fails, naming both.
 */
async function legacyRegistrations(root: string): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  for (const entry of await entriesOf(
    `${root}/${serviceRegistrationsDirectory}`,
    (file) => file.endsWith(".yaml"),
  )) {
    const relative = `${serviceRegistrationsDirectory}/${entry}`;
    const name = await registrationName(root, relative);
    const owner = owners.get(name);
    if (owner !== undefined) {
      throw new Error(
        `${relative}: the registered Service name ${name} is already registered in ${owner}`,
      );
    }
    owners.set(name, relative);
  }
  return owners;
}

/** A spec file of an overlay: a JSON file that is neither hidden nor a release file. */
const isSpecFile = (entry: string): boolean =>
  !entry.startsWith(".") &&
  entry.endsWith(".json") &&
  !entry.endsWith(".release.json");

/**
 * This environment's spec files by name, each keyed to its repository path. A spec
 * file is named after its file, so its metadata.name must equal the file name. Its
 * spec need not carry an environments list to be listed here.
 */
async function environmentRegistrations(
  root: string,
  environment: string,
): Promise<Map<string, string>> {
  const directory = environmentServicesDirectory(environment);
  const names = new Map<string, string>();
  for (const entry of await entriesOf(`${root}/${directory}`, isSpecFile)) {
    const relative = `${directory}/${entry}`;
    const stem = entry.slice(0, -".json".length);
    const name = await registrationName(root, relative);
    if (name !== stem) {
      throw new Error(
        `${relative}: metadata.name ${name} must equal the file name ${stem}, so the record is named after its file`,
      );
    }
    names.set(name, relative);
  }
  return names;
}

/**
 * The Service names this environment serves: the legacy registrations and the
 * environment's spec files (ADR 0166), sorted, each name once. A name in both
 * places is listed once here; kore validate still refuses it (app-records.ts).
 * The derivation reads no feature flag. An invalid registration fails here,
 * naming its file, before anything renders. A repository with neither directory
 * has no names.
 */
export async function loadServiceRegistrations(
  root: string,
  environment: string,
): Promise<string[]> {
  const names = new Set<string>([
    ...(await legacyRegistrations(root)).keys(),
    ...(await environmentRegistrations(root, environment)).keys(),
  ]);
  return [...names].sort();
}

/**
 * The foreign names of one environment's service specs, sorted, while acme-dns01 is on
 * (ADR 0157, issue 1678). Off, no spec is read, so a render with the flag off is what it
 * was before. The platform domain in force decides which names are foreign.
 */
export async function loadForeignNames(
  root: string,
  environment: Environment,
): Promise<string[]> {
  if (!featureEnabled(environment, acmeDns01Flag)) {
    return [];
  }
  return loadForeignCertificateNames(
    root,
    environmentServicesDirectory(environment.name),
    platformPlan(environment, process.env).domain,
  );
}

/**
 * The file that declares each legacy registration, keyed by name. The uniqueness
 * check reads it beside this environment's spec files (app-records.ts).
 */
export async function registrationPaths(
  root: string,
): Promise<Map<string, string>> {
  return legacyRegistrations(root);
}

/**
 * Helm arguments that hand the registered Service names to the observability
 * chart. Passed only while its own flag, platform-portal, is on; otherwise none.
 */
export function registeredServiceHelmArgs(
  environment: Pick<Environment, "features">,
  component: string,
  names: readonly string[],
): string[] {
  if (
    component !== serviceObservabilityComponent ||
    !featureEnabled(environment, platformPortalFlag)
  ) {
    return [];
  }
  return ["--set-json", `services=${JSON.stringify(names)}`];
}
