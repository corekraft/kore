import {
  featureEnabled,
  platformDnsFlag,
  platformSharedGatewayFlag,
} from "./features.js";
import type { Environment } from "./types.js";

/** The platform domain and the platform organization's identifier. */
export interface PlatformPlan {
  domain: string;
  organizationId: string;
}

/**
 * Longest platform domain: the 253-character name limit less a 63-character
 * service label and the organization identifier `platform` with their dots
 * (ADR 0042). The platform charts' schemas hold the same bound.
 */
export const maxDomainLength = 180;

const label = "[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?";
const domainPattern = new RegExp(`^(?:${label}\\.)+${label}$`);
const labelPattern = new RegExp(`^${label}$`);

const missing = (environment: Environment) =>
  `environment ${environment.name} must declare platform.domain and platform.organizationId (for example kore.local and platform)`;

/** The field as declared, widened because an overlay can omit or half-fill it. */
function declared(environment: Environment): Partial<PlatformPlan> | undefined {
  return environment.platform;
}

/** Reads the environment's one platform field; every derived copy goes through it. */
export function platformPlan(environment: Environment): PlatformPlan {
  const field = declared(environment);
  if (field?.domain === undefined || field.organizationId === undefined) {
    throw new Error(missing(environment));
  }
  return { domain: field.domain, organizationId: field.organizationId };
}

/**
 * Schema checks of platform.domain and platform.organizationId, run before any
 * cluster command so a bad value fails up front with the fix.
 */
export function platformDomainErrors(environment: Environment): string[] {
  const field = declared(environment);
  if (field === undefined) {
    return [missing(environment)];
  }
  const { domain, organizationId } = field;
  const where = `in environment ${environment.name}`;
  const domainValid = typeof domain === "string" && domainPattern.test(domain);
  return [
    ...(domainValid
      ? []
      : [
          `platform.domain must be a lowercase DNS name of at least two labels, for example kore.local, ${where}, got ${JSON.stringify(domain)}`,
        ]),
    ...(domainValid && domain.length > maxDomainLength
      ? [
          `platform.domain must be at most ${maxDomainLength} characters so <service>.<organizationId>.<domain> fits 253, ${where}, got ${domain.length}`,
        ]
      : []),
    ...(typeof organizationId === "string" && labelPattern.test(organizationId)
      ? []
      : [
          `platform.organizationId must be one lowercase DNS label, for example platform, ${where}, got ${JSON.stringify(organizationId)}`,
        ]),
  ];
}

/** The chart value each component that names the platform domain reads it through. */
const domainValueKeys: Record<string, string | undefined> = {
  "kore-platform-apis": "platformDomain",
  "kore-platform-keycloak": "platformDomain",
  "kore-platform-backstage": "platformDomain",
  "kore-platform-config": "gateway.hostname",
  "kore-local-tls": "gateway.hostname",
  "kore-platform-dns": "zone",
};

/**
 * The chart value each component reads the platform organization's wildcard
 * through, `*.<organizationId>.<domain>` (ADR 0132).
 */
const wildcardValueKeys: Record<string, string | undefined> = {
  "kore-platform-config": "gateway.platformHostname",
};

/**
 * The chart value prefix each component that attaches a route to the shared
 * Gateway reads it through (ADR 0133): the portal's top-level `sharedGateway`
 * and the golden-path ApplicationSet's `ingress.sharedGateway`.
 */
const sharedGatewayValueKeys: Record<string, string | undefined> = {
  "kore-platform-backstage": "sharedGateway",
  "kore-golden-path-delivery": "ingress.sharedGateway",
};

/**
 * With platform-shared-gateway on, the Gateway a route attaches to and the
 * organization's domain it serves, `<organizationId>.<domain>`; otherwise none,
 * so the flag off renders what it rendered before.
 */
function sharedGatewayArgs(
  environment: Environment,
  component: string,
): string[] {
  const key = sharedGatewayValueKeys[component];
  if (
    key === undefined ||
    !featureEnabled(environment, platformSharedGatewayFlag)
  ) {
    return [];
  }
  const { domain, organizationId } = platformPlan(environment);
  return [
    ["name", environment.gateway.name],
    ["namespace", environment.gateway.namespace],
    ["domain", `${organizationId}.${domain}`],
  ].flatMap(([field, value]) => ["--set-string", `${key}.${field}=${value}`]);
}

/** The ConfigMap, in the portal's namespace, that carries the local CA its pods trust (ADR 0132). */
export const localCaConfigMap = "kore-local-ca";

/**
 * With platform-dns on, the arguments the platform-dns and portal charts take
 * for in-cluster name resolution: the Gateway whose Service the zone rewrites
 * to, and the CA bundle the portal's pods trust. Off, none.
 */
function clusterResolutionArgs(
  environment: Environment,
  component: string,
): string[] {
  if (!featureEnabled(environment, platformDnsFlag)) {
    return [];
  }
  if (component === "kore-platform-backstage") {
    return ["--set-string", `localCa.configMap=${localCaConfigMap}`];
  }
  if (component === "kore-platform-dns") {
    const { name, namespace } = environment.gateway;
    return [
      "--set-string",
      `gateway.name=${name}`,
      "--set-string",
      `gateway.namespace=${namespace}`,
    ];
  }
  return [];
}

/**
 * Helm arguments that hand the platform domain to a component that names it:
 * the overlay's values files and the chart defaults hold no copy, so the
 * environment's field is the one source.
 */
export function platformHelmArgs(
  environment: Environment,
  component: string,
): string[] {
  const key = domainValueKeys[component];
  const wildcard = wildcardValueKeys[component];
  const shared = [
    ...sharedGatewayArgs(environment, component),
    ...clusterResolutionArgs(environment, component),
  ];
  if (key === undefined && wildcard === undefined) {
    return shared;
  }
  const { domain, organizationId } = platformPlan(environment);
  return [
    ...(key === undefined ? [] : ["--set-string", `${key}=${domain}`]),
    ...(wildcard === undefined
      ? []
      : ["--set-string", `${wildcard}=*.${organizationId}.${domain}`]),
    ...shared,
  ];
}
