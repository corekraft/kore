// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
import { externalDnsFlag, featureEnabled } from "./features.js";
import { isLocalProvider } from "./provider.js";
import { runTimeDomain, platformDomainVariable } from "./run-time-domain.js";
import { runTimeValue, runTimeVariables } from "./run-time.js";
import type { Environment } from "./types.js";

/** The catalog component external-dns is installed as (infra/catalog/components.yaml). */
export const externalDnsComponent = "external-dns";

/** The address a local run's records target: the loopback entry point (ADR 0132). */
const localTarget = "127.0.0.1";

/** The platform domain in force: the run-time variable on a managed environment, else the overlay's field. */
function domainInForce(
  environment: Environment,
  env: NodeJS.ProcessEnv,
): string {
  return runTimeDomain(environment, env) ?? environment.platform?.domain ?? "";
}

/**
 * Problems that refuse a mutation while external-dns is on: a managed
 * environment still on the placeholder domain, and a run-time value the
 * provider needs and the environment does not supply, each named. Local
 * (inmemory) needs no run-time value and no credential. Empty while the flag
 * is off, and for every component but external-dns.
 */
export function externalDnsErrors(
  environment: Environment,
  component: string,
  env: NodeJS.ProcessEnv,
): string[] {
  if (
    component !== externalDnsComponent ||
    !featureEnabled(environment, externalDnsFlag)
  ) {
    return [];
  }
  const prefix = `environment ${environment.name} turns on ${externalDnsFlag}, which needs`;
  const suffix = `, or turn ${externalDnsFlag} off`;
  const placeholder =
    environment.provider === "managed" &&
    runTimeDomain(environment, env) === undefined
      ? [
          `${prefix} the platform domain: the overlay holds the placeholder ${environment.platform?.domain ?? ""}; set ${platformDomainVariable} in the shell that runs kore to the platform domain${suffix}`,
        ]
      : [];
  if (isLocalProvider(environment)) {
    return placeholder;
  }
  const address = runTimeValue(runTimeVariables.publicIPv4, env, {});
  const zone = runTimeValue(runTimeVariables.cloudflareZoneId, env, {});
  return [
    ...placeholder,
    ...(address === undefined
      ? [
          `${prefix} the run-time value ${runTimeVariables.publicIPv4} (the host's public IPv4 address); set it in the shell that runs kore${suffix}`,
        ]
      : []),
    ...(zone === undefined
      ? [
          `${prefix} the run-time value ${runTimeVariables.cloudflareZoneId} (the Cloudflare zone id of the platform domain); set it in the shell that runs kore${suffix}`,
        ]
      : []),
  ];
}

/**
 * The Helm arguments external-dns takes from the environment: the one platform
 * domain as its domain filter, internal.<domain> as its exclusion (by
 * configuration, ADR 0162), the target address (the loopback address locally,
 * the run-time public IPv4 otherwise), and on the Cloudflare provider the one
 * zone as its zone-id filter. Off, or for another component, none. Refuses
 * with the errors above rather than rendering a partial set.
 */
export function externalDnsHelmArgs(
  environment: Environment,
  component: string,
  env: NodeJS.ProcessEnv,
): string[] {
  if (
    component !== externalDnsComponent ||
    !featureEnabled(environment, externalDnsFlag)
  ) {
    return [];
  }
  const errors = externalDnsErrors(environment, component, env);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  const domain = domainInForce(environment, env);
  const local = isLocalProvider(environment);
  const target = local
    ? localTarget
    : runTimeValue(runTimeVariables.publicIPv4, env, {});
  const zone = local
    ? undefined
    : runTimeValue(runTimeVariables.cloudflareZoneId, env, {});
  return [
    "--set-string",
    `domainFilters[0]=${domain}`,
    "--set-string",
    `excludeDomains[0]=internal.${domain}`,
    "--set-string",
    `extraArgs.default-targets=${target ?? ""}`,
    ...(zone === undefined
      ? []
      : ["--set-string", `extraArgs.zone-id-filter=${zone}`]),
  ];
}
