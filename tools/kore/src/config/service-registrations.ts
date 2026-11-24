import { readdir, readFile } from "node:fs/promises";
import { featureEnabled, platformPortalFlag } from "./features.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0115-scope-the-organization-and-service-platform-apis-to-the-cluster.md
// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md

/** The directory, in git, that holds one Service registration per file. */
export const serviceRegistrationsDirectory = "infra/services";

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

/** The name one registration file declares, or a failure that names the file. */
async function registrationName(
  directory: string,
  file: string,
): Promise<string> {
  const relative = `${serviceRegistrationsDirectory}/${file}`;
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(`${directory}/${file}`, "utf8"));
  } catch (error) {
    throw new Error(
      `${relative}: registrations must use JSON-compatible YAML: ${String(error)}`,
    );
  }
  const record = (
    typeof manifest === "object" && manifest !== null ? manifest : {}
  ) as { kind?: unknown; metadata?: { name?: unknown } };
  if (record.kind !== "Service") {
    throw new Error(
      `${relative}: a registration must be a Service manifest (kind Service)`,
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

/** The registration files in the directory, sorted; none when the directory is absent. */
async function registrationFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory))
      .filter((entry) => entry.endsWith(".yaml"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * The Service names the registrations in git declare, sorted. The derivation
 * reads no feature flag: any later consumer reads the names from here. An
 * invalid registration fails here, naming its file, before anything renders.
 * A repository with no registrations directory has no names.
 */
export async function loadServiceRegistrations(
  root: string,
): Promise<string[]> {
  const directory = `${root}/${serviceRegistrationsDirectory}`;
  const owners = new Map<string, string>();
  for (const file of await registrationFiles(directory)) {
    const name = await registrationName(directory, file);
    const owner = owners.get(name);
    if (owner !== undefined) {
      throw new Error(
        `${serviceRegistrationsDirectory}/${file}: the registered Service name ${name} is already registered in ${owner}`,
      );
    }
    owners.set(name, `${serviceRegistrationsDirectory}/${file}`);
  }
  return [...owners.keys()].sort();
}

/**
 * The file that declares each registered Service name, keyed by name, each file
 * a repository path. loadRepository has already refused an invalid registration
 * and a duplicate name, so this reads the same files without repeating those checks.
 */
export async function registrationPaths(
  root: string,
): Promise<Map<string, string>> {
  const directory = `${root}/${serviceRegistrationsDirectory}`;
  const paths = new Map<string, string>();
  for (const file of await registrationFiles(directory)) {
    paths.set(
      await registrationName(directory, file),
      `${serviceRegistrationsDirectory}/${file}`,
    );
  }
  return paths;
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
