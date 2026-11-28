// The foreign names that get a certificate of their own, proven over HTTP-01 (ADR 0157, issue 1678).
// A name a service claims on the external Gateway under a domain the platform does not own is
// one name, one Certificate; it never takes a wildcard, and it never takes a credential, since
// the platform holds none for a zone it does not control. Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md
// Only kore reads the spec files here; validation refuses a malformed name before any mutation.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formError,
  resolveHostname,
  type ServiceClaim,
} from "./hostname-claims.js";

const specSuffix = ".json";
const releaseSuffix = ".release.json";

/**
 * The name of the Certificate a foreign name gets, derived as the platform certificate
 * chart derives it (infra/charts/platform-certificate/templates/foreign-certificates.yaml):
 * `foreign-`, the name's dots as dashes cut to forty characters with one trailing dash
 * removed, and eight hex digits of its SHA-256. Readiness waits on this name, so the two
 * must agree; the chart's integration spec checks them against each other.
 */
export function foreignCertificateName(host: string): string {
  const label = host.replaceAll(".", "-").slice(0, 40).replace(/-$/, "");
  const digest = createHash("sha256").update(host).digest("hex").slice(0, 8);
  return `foreign-${label}-${digest}`;
}

/**
 * The foreign names the services claim on the external Gateway, sorted and unique.
 * A name on the internal Gateway, a name under the platform domain, a bare label and a
 * name the form rules refuse (a wildcard, an uppercase name) are not listed: a foreign
 * name is served only on the external Gateway (ADR 0157), and validation refuses a
 * malformed one before anything renders.
 */
export function foreignCertificateNames(
  services: readonly ServiceClaim[],
  domain: string,
): string[] {
  const names = new Set<string>();
  for (const service of services) {
    if (service.gateway !== "external" || !Array.isArray(service.hostnames)) {
      continue;
    }
    for (const host of service.hostnames) {
      if (typeof host !== "string" || formError(host, "").length > 0) {
        continue;
      }
      const resolved = resolveHostname(host, domain);
      if (resolved.foreign) {
        names.add(resolved.name);
      }
    }
  }
  return [...names].sort();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The claim fields of one spec file's text, or undefined when the text is not JSON. */
function claimOf(
  name: string,
  file: string,
  text: string,
): ServiceClaim | undefined {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text);
  } catch {
    // Validate reports a spec that is not strict JSON, so the foreign names skip it.
    return undefined;
  }
  const spec =
    isRecord(manifest) && isRecord(manifest.spec) ? manifest.spec : {};
  return {
    file,
    name,
    organization: spec.organization,
    gateway: spec.gateway,
    hostnames: spec.hostnames,
  };
}

/**
 * The foreign names of the spec files in one services directory (relative to the
 * root). Release files are not specs and are skipped; a missing directory has none.
 */
export async function loadForeignCertificateNames(
  root: string,
  directory: string,
  domain: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(join(root, directory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const services: ServiceClaim[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(specSuffix) || entry.endsWith(releaseSuffix)) {
      continue;
    }
    const text = await readFile(join(root, directory, entry), "utf8");
    const claim = claimOf(
      entry.slice(0, -specSuffix.length),
      `${directory}/${entry}`,
      text,
    );
    if (claim !== undefined) {
      services.push(claim);
    }
  }
  return foreignCertificateNames(services, domain);
}
