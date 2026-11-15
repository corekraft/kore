// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// Offline mirror of the Organization and Service XRD schemas in
// infra/charts/platform-apis. The chart stays the runtime owner; the
// integration test in integration/config fails when the two drift apart.

export const platformApiVersion = "platform.kore.dev/v1alpha1";

/** The DNS label pattern the XRDs use for tenant, parent and environment names. */
export const dnsLabelPattern = "^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$";

const dnsLabel = new RegExp(dnsLabelPattern);

/** XRD messages this module mirrors; the chart must still contain each one. */
export const mirroredXrdFragments: readonly string[] = [
  "metadata.name must be a single DNS label",
  "metadata.name must not contain a double hyphen",
  "spec.environments must not contain a double hyphen",
  "must be at most 63 characters",
  "must not use a reserved prefix",
  "only the platform organization is supported",
  "enum: [platform]",
];

const platformOrganization = "platform";
const reservedPrefixes = ["kube-", "kore-"];
const namespaceLimit = 63;

type Claim = Record<string, unknown>;

const isRecord = (value: unknown): value is Claim =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const subject = (value: unknown): Claim => (isRecord(value) ? value : {});

/** A claim field as text for a message: a non-string shows as JSON, never as [object Object]. */
const text = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");

function organizationErrors(claim: Claim, path: string): string[] {
  const name = subject(claim.metadata).name;
  const spec = subject(claim.spec);
  const errors: string[] = [];
  if (name !== platformOrganization) {
    errors.push(
      `${path}.metadata.name: only the platform organization is supported; set it to "${platformOrganization}"`,
    );
  }
  if (spec.tenant === undefined) {
    errors.push(
      `${path}.spec.tenant: is required; set it to the organization's tenant name, for example "payments"`,
    );
  } else if (!dnsLabel.test(text(spec.tenant))) {
    errors.push(
      `${path}.spec.tenant: must be a lowercase DNS label of letters, digits and hyphens (at most 63); rename it, for example "payments"`,
    );
  }
  if (spec.parent !== undefined && !dnsLabel.test(text(spec.parent))) {
    errors.push(
      `${path}.spec.parent: must be a lowercase DNS label of letters, digits and hyphens (at most 63); rename it to the parent organization's tenant name`,
    );
  }
  return errors;
}

function serviceNameErrors(name: string, path: string): string[] {
  const errors: string[] = [];
  if (!dnsLabel.test(name)) {
    errors.push(
      `${path}.metadata.name: must be a single DNS label (lowercase letters, digits and hyphens, at most 63 characters, no dots): the default host is <service>.<organization>.<platform domain>; rename it, for example "${name.replaceAll(".", "-")}"`,
    );
  }
  if (name.includes("--")) {
    errors.push(
      `${path}.metadata.name: must not contain a double hyphen, because the namespace is <service>--<environment>; rename it, for example "${name.replaceAll("--", "-")}"`,
    );
  }
  const prefix = reservedPrefixes.find((reserved) => name.startsWith(reserved));
  if (prefix !== undefined) {
    errors.push(
      `${path}.metadata.name: must not start with kube- or kore-, the reserved prefixes; rename it, for example "${name.slice(prefix.length)}"`,
    );
  }
  return errors;
}

function serviceEnvironmentErrors(
  name: string,
  environments: unknown[],
  path: string,
): string[] {
  const errors: string[] = [];
  environments.forEach((environment, index) => {
    const env = String(environment);
    if (environments.indexOf(environment) !== index) {
      errors.push(
        `${path}.spec.environments: must not repeat "${env}"; remove the duplicate`,
      );
    } else if (!dnsLabel.test(env) || env.includes("--")) {
      errors.push(
        `${path}.spec.environments: "${env}" must be a lowercase DNS label with no double hyphen; rename it, for example "local"`,
      );
    } else if (name.length + 2 + env.length > namespaceLimit) {
      errors.push(
        `${path}.spec.environments: the namespace ${name}--${env} is longer than ${namespaceLimit} characters; shorten metadata.name or the environment name`,
      );
    }
  });
  return errors;
}

function serviceErrors(claim: Claim, path: string): string[] {
  const name = text(subject(claim.metadata).name);
  const spec = subject(claim.spec);
  const errors = serviceNameErrors(name, path);
  if (spec.organization !== platformOrganization) {
    errors.push(
      `${path}.spec.organization: must be "${platformOrganization}"; the Service API serves only the platform organization`,
    );
  }
  if (!Array.isArray(spec.environments) || spec.environments.length === 0) {
    errors.push(
      `${path}.spec.environments: needs at least one environment; add one, for example "local"`,
    );
  } else {
    errors.push(...serviceEnvironmentErrors(name, spec.environments, path));
  }
  return errors;
}

function claimErrors(claim: unknown, path: string): string[] {
  if (!isRecord(claim)) {
    return [
      `${path}: must be an object with apiVersion, kind and metadata.name`,
    ];
  }
  const errors: string[] = [];
  if (claim.apiVersion !== platformApiVersion) {
    errors.push(
      `${path}.apiVersion: must be ${platformApiVersion}; set it to that value`,
    );
  }
  if (claim.kind === "Organization") {
    return [...errors, ...organizationErrors(claim, path)];
  }
  if (claim.kind === "Service") {
    return [...errors, ...serviceErrors(claim, path)];
  }
  return [
    ...errors,
    `${path}.kind: ${String(claim.kind)} is not a platform claim; use Organization or Service`,
  ];
}

/**
 * Every rule the Organization and Service XRDs apply to a claims document, as
 * messages that name the field and the fix. Pure: it reads nothing and never
 * consults the feature flag, which the caller checks first.
 */
export function platformClaimErrors(claims: unknown): string[] {
  if (!Array.isArray(claims)) {
    return [
      "claims must be a JSON array of Organization and Service objects; wrap the claim in [ ]",
    ];
  }
  return claims.flatMap((claim, index) =>
    claimErrors(claim, `claims[${index}]`),
  );
}
