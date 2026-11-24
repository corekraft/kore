// Docs: docs/decisions/0042-organization-domains-by-delegation.md
// Offline mirror of the Organization and Service XRD schemas in
// infra/charts/platform-apis. The chart stays the runtime owner; the
// integration test in integration/config fails when the two drift apart. That
// test holds the chart's pattern and rule messages as literals. It exports
// platformClaimErrors and serviceNameErrors, the Service name rules the app
// record check (app-record-rules.ts) reuses, so the name rules live in one place.

const platformApiVersion = "platform.kore.dev/v1alpha1";

/** The DNS label pattern the XRDs use for tenant, parent and environment names. */
const dnsLabel = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

const platformOrganization = "platform";
const reservedPrefixes = ["kube-", "kore-"];
const namespaceLimit = 63;
/**
 * The longest derived label is the Argo Application golden-path-<service>: Argo CD's
 * default label tracking copies its name into a 63-character label value.
 */
const applicationPrefix = "golden-path-";
const serviceNameLimit = namespaceLimit - applicationPrefix.length;

type Claim = Record<string, unknown>;

const isRecord = (value: unknown): value is Claim =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const subject = (value: unknown): Claim => (isRecord(value) ? value : {});

/** A claim field as text for a message: a non-string shows as JSON, never as [object Object]. */
const text = (value: unknown): string =>
  typeof value === "string" ? value : (JSON.stringify(value) ?? "");

/** A suborg's name is at most this long, so <suborg>--preview fits a 63-character namespace (ADR 0165). */
const suborgNameLimit = 54;
const quotaFields = ["requests", "pods", "storage"];
const requestFields = ["cpu", "memory"];
const cpuPattern = /^[0-9]+(\.[0-9]+)?m?$/;
const memoryPattern = /^[0-9]+(\.[0-9]+)?(Mi|Gi|Ti)$/;
const storagePattern = /^[0-9]+(\.[0-9]+)?(Gi|Ti)$/;

/** A suborg's name rules, as the Organization XRD states them (the reserved names are kore validate's). */
function suborgNameErrors(name: string, path: string): string[] {
  const errors: string[] = [];
  if (!dnsLabel.test(name)) {
    errors.push(
      `${path}.metadata.name: must be a single DNS label (lowercase letters, digits and hyphens, at most 63 characters, no dots); rename it, for example "${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}"`,
    );
  }
  if (name.includes("--")) {
    errors.push(
      `${path}.metadata.name: must not contain a double hyphen: the suborg namespace is <suborg> and its preview is <suborg>--preview; rename it, for example "${name.replaceAll("--", "-")}"`,
    );
  }
  if (name.length > suborgNameLimit) {
    errors.push(
      `${path}.metadata.name: must be at most ${suborgNameLimit} characters, so <suborg>--preview fits 63; shorten it, for example "${name.slice(0, suborgNameLimit)}"`,
    );
  }
  return errors;
}

/** The requests of a quota: cpu and memory, each named with the form it must take. */
function requestErrors(requests: unknown, field: string): string[] {
  if (!isRecord(requests)) {
    return [
      `${field}.requests: is required and must be an object with cpu and memory`,
    ];
  }
  const errors = Object.keys(requests)
    .filter((key) => !requestFields.includes(key))
    .map(
      (key) =>
        `${field}.requests.${key}: is not a quota field; the request fields are cpu and memory`,
    );
  if (requests.cpu === undefined) {
    errors.push(
      `${field}.requests.cpu: is required; set a CPU quantity such as "8" or "500m"`,
    );
  } else if (
    typeof requests.cpu !== "string" ||
    !cpuPattern.test(requests.cpu)
  ) {
    errors.push(
      `${field}.requests.cpu: must be a CPU quantity such as "8" or "500m"`,
    );
  }
  if (requests.memory === undefined) {
    errors.push(
      `${field}.requests.memory: is required; set a memory quantity with a Mi, Gi or Ti suffix, such as "16Gi"`,
    );
  } else if (
    typeof requests.memory !== "string" ||
    !memoryPattern.test(requests.memory)
  ) {
    errors.push(
      `${field}.requests.memory: must be a memory quantity with a Mi, Gi or Ti suffix, such as "16Gi"`,
    );
  }
  return errors;
}

/** The quota's fields, each named with the form it must take (the XRD's patterns). */
function quotaErrors(quota: unknown, path: string): string[] {
  const field = `${path}.spec.quota`;
  if (!isRecord(quota)) {
    return [
      `${field}: must be an object with requests (cpu and memory), pods and storage`,
    ];
  }
  const errors = Object.keys(quota)
    .filter((key) => !quotaFields.includes(key))
    .map(
      (key) =>
        `${field}.${key}: is not a quota field; the fields are requests, pods and storage`,
    );
  errors.push(...requestErrors(quota.requests, field));
  const pods = quota.pods;
  if (pods === undefined) {
    errors.push(
      `${field}.pods: is required; set a whole number of at least 1, for example 50`,
    );
  } else if (!Number.isInteger(pods) || (pods as number) < 1) {
    errors.push(
      `${field}.pods: must be a whole number of at least 1, for example 50`,
    );
  }
  const storage = quota.storage;
  if (storage === undefined) {
    errors.push(
      `${field}.storage: is required; set a storage quantity with a Gi or Ti suffix, such as "100Gi"`,
    );
  } else if (typeof storage !== "string" || !storagePattern.test(storage)) {
    errors.push(
      `${field}.storage: must be a storage quantity with a Gi or Ti suffix, such as "100Gi"`,
    );
  }
  return errors;
}

function organizationErrors(claim: Claim, path: string): string[] {
  const name = text(subject(claim.metadata).name);
  const spec = subject(claim.spec);
  const errors: string[] = [];
  if (name === platformOrganization) {
    if (spec.parent !== undefined) {
      errors.push(
        `${path}.spec.parent: the platform organization is the tenant root and has no parent; remove spec.parent`,
      );
    }
  } else {
    errors.push(...suborgNameErrors(name, path));
    if (spec.parent === undefined) {
      errors.push(
        `${path}.spec.parent: is required for a suborg; set it to "${platformOrganization}", the tenant root`,
      );
    }
    if (spec.quota === undefined) {
      errors.push(
        `${path}.spec.quota: is required for a suborg, and has no default: set requests.cpu, requests.memory, pods and storage`,
      );
    }
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
  } else if (
    name !== platformOrganization &&
    spec.parent !== undefined &&
    text(spec.parent) !== platformOrganization
  ) {
    errors.push(
      `${path}.spec.parent: must be "${platformOrganization}", the tenant root: v1 places a suborg one level below it; set it to "${platformOrganization}"`,
    );
  }
  if (spec.quota !== undefined) {
    errors.push(...quotaErrors(spec.quota, path));
  }
  return errors;
}

/** The Service name rules of the XRD, as messages that name `path`. */
export function serviceNameErrors(name: string, path: string): string[] {
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
  if (!/^[a-z]/.test(name)) {
    errors.push(
      `${path}.metadata.name: must start with a lowercase letter (a Kubernetes Service name cannot start with a digit); rename it, for example "s${name}"`,
    );
  }
  if (name.length > serviceNameLimit) {
    errors.push(
      `${path}.metadata.name: must be at most ${serviceNameLimit} characters, because the longest derived label, the Argo Application golden-path-<service>, adds ${applicationPrefix.length} characters to fit ${namespaceLimit}; shorten it, for example "${name.slice(0, serviceNameLimit)}"`,
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
