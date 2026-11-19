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
 * Helm arguments that hand the platform domain to a component that names it:
 * the overlay's values files and the chart defaults hold no copy, so the
 * environment's field is the one source.
 */
export function platformHelmArgs(
  environment: Environment,
  component: string,
): string[] {
  const key = domainValueKeys[component];
  return key === undefined
    ? []
    : ["--set-string", `${key}=${platformPlan(environment).domain}`];
}
