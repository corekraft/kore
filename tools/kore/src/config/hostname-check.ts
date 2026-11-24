// Reads what the hostname claim rules need for one environment: the reserved-name list
// and its coverage of the app model's reserved suborg names, the domains in force and
// the Gateway facts, the suborgs and the services' claims. Then it applies the rules
// (hostname-claims.ts). Read-only: it reads the working tree and contacts no cluster.
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md

import {
  hostnameClaimErrors,
  type ClaimEnvironment,
  type ServiceClaim,
} from "./hostname-claims.js";
import { externalGateway } from "./gateways.js";
import { suborgRecords } from "./organization-records.js";
import { platformPlan } from "./platform-domain.js";
import {
  readReservedHostnames,
  reservedCoverageErrors,
  reservedHostnamesPath,
} from "./reserved-hostnames.js";
import { placeholderPlatformDomain } from "./service-names.js";
import { reservedSuborgNames } from "./suborg-names.js";
import type { Environment } from "./types.js";

/** What the hostname check of one environment reads. */
export interface HostnameCheck {
  /** The repository root. */
  root: string;
  environment: Environment;
  /** The environment variables the run-time domain may come from; process.env unless a test passes one. */
  env?: NodeJS.ProcessEnv | undefined;
  /** The catalog's component namespaces, which the reserved list must carry (ADR 0165). */
  catalogNamespaces: readonly string[];
}

/** A parsed spec file of the services directory, by service name. */
export interface ParsedService {
  file: string;
  manifest: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The claim fields of one spec file, read as far as the rules need them. */
function claimOf(name: string, service: ParsedService): ServiceClaim {
  const spec =
    isRecord(service.manifest) && isRecord(service.manifest.spec)
      ? service.manifest.spec
      : {};
  return {
    file: service.file,
    name,
    organization: spec.organization,
    gateway: spec.gateway,
    hostnames: spec.hostnames,
  };
}

/**
 * The problems of the reserved-name list and the hostname claims of one environment,
 * each naming its file. Runs even with no services: a malformed list fails either way.
 */
export async function hostnameFileErrors(
  check: HostnameCheck,
  services: ReadonlyMap<string, ParsedService>,
): Promise<string[]> {
  const { root, environment, env, catalogNamespaces } = check;
  const reserved = await readReservedHostnames(root);
  const coverage = reservedCoverageErrors(
    reservedHostnamesPath,
    reserved.names,
    [...reservedSuborgNames(catalogNamespaces)],
  );
  const plan = platformPlan(environment, env);
  const external = externalGateway(environment) !== undefined;
  const claimEnvironment: ClaimEnvironment = {
    domain: plan.domain,
    internalDomain: external ? `internal.${plan.domain}` : plan.domain,
    externalGateway: external,
    placeholder: plan.domain === placeholderPlatformDomain,
  };
  const claims = [...services].map(([name, service]) => claimOf(name, service));
  const suborgs = await suborgRecords(root, environment);
  return [
    ...reserved.errors,
    ...coverage,
    ...hostnameClaimErrors({
      environment: claimEnvironment,
      services: claims,
      suborgs,
      reserved: reserved.names,
    }),
  ];
}
