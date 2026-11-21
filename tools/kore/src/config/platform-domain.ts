import {
  databaseRoutesFlag,
  featureEnabled,
  platformDnsFlag,
  otlpRouteFlag,
  platformHostnameOwnershipFlag,
  platformSharedGatewayFlag,
} from "./features.js";
import type { Environment } from "./types.js";

/** The platform domain and the platform organization's identifier. */
export interface PlatformPlan {
  domain: string;
  organizationId: string;
}

/**
 * The field as an overlay may declare it. The deprecated alias is removed (ADR
 * 0176): it is read only to refuse an overlay that still declares it.
 */
type DeclaredPlatform = Partial<PlatformPlan> & { deprecatedAlias?: unknown };

/**
 * The loopback port a host reaches the platform Gateway on (ADR 0132, ADR 0176).
 * The k3d load balancer publishes it beside the in-cluster listener port
 * gateway.port, which no host reaches once the 8443 mapping is removed; the
 * readers of the host entry point take it from here.
 */
export const gatewayEntryPort = 443;

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
  `environment ${environment.name} must declare platform.domain and platform.organizationId (for example kore.internal and platform)`;

/** The field as declared, widened because an overlay can omit or half-fill it. */
function declared(environment: Environment): DeclaredPlatform | undefined {
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
 * The refusal of an overlay that still declares the removed deprecated alias
 * (ADR 0176). It is refused, not ignored, so the listener cannot come back
 * unnoticed.
 */
function removedAliasError(environment: Environment): string {
  return `platform.deprecatedAlias was removed with the kore.local listener (ADR 0176); delete the field from environment ${environment.name}`;
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
          `platform.domain must be a lowercase DNS name of at least two labels, for example kore.internal, ${where}, got ${JSON.stringify(domain)}`,
        ]),
    ...(domainValid && domain.length > maxDomainLength
      ? [
          `platform.domain must be at most ${maxDomainLength} characters so <service>.<organizationId>.<domain> fits 253, ${where}, got ${domain.length}`,
        ]
      : []),
    ...(field.deprecatedAlias === undefined
      ? []
      : [removedAliasError(environment)]),
    ...(typeof organizationId === "string" && labelPattern.test(organizationId)
      ? []
      : [
          `platform.organizationId must be one lowercase DNS label, for example platform, ${where}, got ${JSON.stringify(organizationId)}`,
        ]),
  ];
}

/**
 * The platform organization's wildcard, `*.<organizationId>.<domain>` (ADR 0132).
 * The one derivation: the Helm path and the delivery chart's values both take it
 * from here, so the two renders cannot disagree.
 */
export function platformWildcard(environment: Environment): string {
  const { domain, organizationId } = platformPlan(environment);
  return `*.${organizationId}.${domain}`;
}

/**
 * The OTLP receiver's name under the platform organization,
 * `otlp.<organizationId>.<domain>` (ADR 0140): the one derivation that the OTLP
 * route's chart and the live telemetry test both take from here.
 */
export function otlpHostname(environment: Environment): string {
  const { domain, organizationId } = platformPlan(environment);
  return `otlp.${organizationId}.${domain}`;
}

/** Whether OTLP is reached by its name through the shared Gateway (ADR 0140). */
export function otlpByName(environment: Environment): boolean {
  return featureEnabled(environment, otlpRouteFlag);
}

/**
 * With otlp-route on, the values the OTLP route chart takes for its name and the
 * shared Gateway its HTTPS route attaches to (ADR 0140). Off, none is passed, so
 * the flag off renders what it rendered before.
 */
function otlpRouteArgs(environment: Environment, component: string): string[] {
  if (component !== "kore-otlp-route" || !otlpByName(environment)) {
    return [];
  }
  return [
    "--set-string",
    `otlpRoute.hostname=${otlpHostname(environment)}`,
    "--set-string",
    `otlpRoute.gateway.name=${environment.gateway.name}`,
    "--set-string",
    `otlpRoute.gateway.namespace=${environment.gateway.namespace}`,
  ];
}

/** The chart value each component that names the platform domain reads it through. */
const domainValueKeys: Record<string, string | undefined> = {
  "kore-platform-apis": "platformDomain",
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
  "kore-platform-keycloak": "sharedGateway",
  "kore-golden-path-delivery": "ingress.sharedGateway",
};

/**
 * Keycloak's host, which the Keycloak chart and the portal's sign-in both take:
 * keycloak.<organizationId>.<domain> while platform-shared-gateway is on, where the
 * platform Gateway serves it by name (ADR 0133); otherwise keycloak.<domain>, the
 * host the flag off renders.
 */
export function keycloakHostname(environment: Environment): string {
  const { domain, organizationId } = platformPlan(environment);
  return featureEnabled(environment, platformSharedGatewayFlag)
    ? `keycloak.${organizationId}.${domain}`
    : `keycloak.${domain}`;
}

/**
 * The portal's host (ADR 0111, ADR 0042, ADR 0133): backstage.<organizationId>.<domain>
 * while platform-shared-gateway is on, the host the shared platform Gateway serves
 * by name, and backstage.<domain> while it is off, the host the flag off renders.
 * The portal chart's route, its base URL, its sign-in redirect and its Keycloak
 * client take this one value, and so does the sign-in check.
 */
export function backstageHostname(environment: Environment): string {
  const { domain, organizationId } = platformPlan(environment);
  return featureEnabled(environment, platformSharedGatewayFlag)
    ? `backstage.${organizationId}.${domain}`
    : `backstage.${domain}`;
}

/** The portal's host, which the portal chart takes from backstageHostname. */
function backstageHostArgs(
  environment: Environment,
  component: string,
): string[] {
  return component === "kore-platform-backstage"
    ? ["--set-string", `backstageHostname=${backstageHostname(environment)}`]
    : [];
}

const keycloakHostComponents = [
  "kore-platform-keycloak",
  "kore-platform-backstage",
];

/** The Keycloak host the Keycloak chart and the portal take, from the one derivation. */
function keycloakHostArgs(
  environment: Environment,
  component: string,
): string[] {
  return keycloakHostComponents.includes(component)
    ? ["--set-string", `keycloakHostname=${keycloakHostname(environment)}`]
    : [];
}

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
  // The portal's host is backstageHostname, so its sharedGateway takes no domain.
  return [
    ["name", environment.gateway.name],
    ["namespace", environment.gateway.namespace],
    ...(component === "kore-platform-backstage"
      ? []
      : [["domain", `${organizationId}.${domain}`]]),
  ].flatMap(([field, value]) => ["--set-string", `${key}.${field}=${value}`]);
}

/**
 * With database-routes on, the values a PostgreSQL chart takes (ADR 0137): the
 * certificate rule of the composition's RBAC, and for the composition itself the
 * platform domain and organization identifier its derived host is built from, and
 * the Gateway its database routes attach to (ADR 0139).
 * Off, none is passed, so the flag off renders what it rendered before.
 */
function databaseRoutesArgs(
  environment: Environment,
  component: string,
): string[] {
  if (!featureEnabled(environment, databaseRoutesFlag)) {
    return [];
  }
  if (component === "kore-postgresql-rbac") {
    return ["--set", "databaseRoutes=true"];
  }
  if (component === "kore-postgresql-api") {
    const { domain, organizationId } = platformPlan(environment);
    return [
      "--set",
      "databaseRoutes=true",
      "--set-string",
      `platformDomain=${domain}`,
      "--set-string",
      `organizationId=${organizationId}`,
      "--set-string",
      `gateway.name=${environment.gateway.name}`,
      "--set-string",
      `gateway.namespace=${environment.gateway.namespace}`,
    ];
  }
  return [];
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
 * With platform-hostname-ownership on, the organization identifier the
 * Organization API builds its zone default from, `<organizationId>.<domain>`;
 * otherwise none, so the flag off renders what it rendered before.
 */
function zoneArgs(environment: Environment, component: string): string[] {
  if (
    component !== "kore-platform-apis" ||
    !featureEnabled(environment, platformHostnameOwnershipFlag)
  ) {
    return [];
  }
  return [
    "--set-string",
    `platformOrganizationId=${platformPlan(environment).organizationId}`,
  ];
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
    ...backstageHostArgs(environment, component),
    ...keycloakHostArgs(environment, component),
    ...zoneArgs(environment, component),
    ...sharedGatewayArgs(environment, component),
    ...clusterResolutionArgs(environment, component),
    ...databaseRoutesArgs(environment, component),
    ...otlpRouteArgs(environment, component),
  ];
  if (key === undefined && wildcard === undefined) {
    return shared;
  }
  const { domain } = platformPlan(environment);
  return [
    ...(key === undefined ? [] : ["--set-string", `${key}=${domain}`]),
    ...(wildcard === undefined
      ? []
      : ["--set-string", `${wildcard}=${platformWildcard(environment)}`]),
    ...shared,
  ];
}
