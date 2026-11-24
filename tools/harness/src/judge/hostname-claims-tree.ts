// The claim inputs of the hostname check, read from GitHub at a commit. The judge cannot
// fetch through the guard, so the touch check reads the files through gh api. The paths
// are the repository layout kore reads (ADR 0159, ADR 0165): the services and suborg
// directories of each environment, the reserved list, the catalog and each overlay. The
// harness never imports tools/kore/src (ADR 0082); the claim rules run through kore validate.
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md

import type { Api } from "./manifest-source.js";

/** The catalog whose namespaces the reserved suborg names are checked against. */
export const CATALOG_PATH = "infra/catalog/components.yaml";
/** The reserved-name list the claim rules read, and its schema. */
export const RESERVED_PATH = "infra/catalog/reserved-hostnames.json";
export const RESERVED_SCHEMA_PATH =
  "infra/catalog/schemas/reserved-hostnames.schema.json";

/** What a claim input feeds: a service's claims, a suborg's name, the reserved list, the platform domain or the catalog. */
export type ClaimKind =
  "service" | "organization" | "overlay" | "reserved" | "catalog";

/** kore's release files sit beside the spec files and carry no claims. */
const RELEASE = /\.release\.json$/;
const RAW = ["api", "-H", "Accept: application/vnd.github.raw"] as const;
const NOT_FOUND = /HTTP 404|Not Found/;

/** The environment a repository path lies in, when it lies under one. */
export function environmentOf(path: string): string | undefined {
  return /^infra\/environments\/([^/]+)\//.exec(path)?.[1];
}

/** The claim input a repository path is, or undefined when no claim rule reads it. */
export function claimKind(path: string): ClaimKind | undefined {
  if (path === RESERVED_PATH || path === RESERVED_SCHEMA_PATH) {
    return "reserved";
  }
  if (path === CATALOG_PATH) {
    return "catalog";
  }
  const environment = environmentOf(path);
  if (environment === undefined) {
    return undefined;
  }
  if (path === `infra/environments/${environment}/environment.yaml`) {
    return "overlay";
  }
  if (!path.endsWith(".json")) {
    return undefined;
  }
  const directly = (directory: string) =>
    path.startsWith(`${directory}/`) &&
    !path.slice(directory.length + 1).includes("/");
  if (directly(`infra/environments/${environment}/services`)) {
    return RELEASE.test(path) ? undefined : "service";
  }
  return directly(`infra/environments/${environment}/organizations`)
    ? "organization"
    : undefined;
}

/** One file at a commit as its text; undefined when the commit has no such file, which gh reports as a 404. */
export async function fileAt(
  api: Api,
  repo: string,
  path: string,
  sha: string,
): Promise<string | undefined> {
  try {
    return await api([...RAW, `repos/${repo}/contents/${path}?ref=${sha}`]);
  } catch (error) {
    if (error instanceof Error && NOT_FOUND.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}
