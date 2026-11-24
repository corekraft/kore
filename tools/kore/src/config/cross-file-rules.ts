// The rules that span files (ADR 0165, ADR 0166): a service names a suborg the environment
// declares, each grant names an existing service of the environment and not the service
// itself, a service's requests fit its suborg's quota, and the suborg quotas together fit the
// environment's committed capacity. Pure: the caller reads the records and passes them in.
// The reader is cross-file-check.ts.
// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md

import { renderSizing, type SizingQuota } from "./app-sizing.js";
import { capacityFit, type Amount } from "./capacity-fit.js";
import { committedFraction, nodeBudget } from "./node-capacity.js";
import { cpuMillis, formatCpu, formatMemory, memoryMiB } from "./quantity.js";
import type { Environment } from "./types.js";

/** The tenant root: it is never a suborg record, and it carries no quota. */
const platform = "platform";

/** A DNS label: a suborg name, a service name or one half of a grant. */
const dnsLabel = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

/** One component's requests as written; an absent request is undefined and counts as zero. */
export interface ComponentRequests {
  component: string;
  cpu: string | undefined;
  memory: string | undefined;
  /** resources.limits.memory; with sizing on it must equal the request (#1525). */
  memoryLimit?: string | undefined;
  /** resources.requests.ephemeralStorage (#1525). */
  ephemeralStorage?: string | undefined;
  /** autoscaling.minReplicas and maxReplicas, when written as numbers (#1525). */
  minReplicas?: number | undefined;
  maxReplicas?: number | undefined;
}

/** A service spec file, as the rules read it: what it names, grants and requests. */
export interface ServiceFacts {
  /** The spec file's repository path, which the messages begin with. */
  file: string;
  /** The service name: the spec file's name without .json. */
  name: string;
  /** spec.organization, when it is a string. */
  organization: string | undefined;
  /** The entries of spec.allowFrom that are strings; the schema refuses the rest. */
  allowFrom: readonly string[];
  /** Each declared component's requests. */
  requests: readonly ComponentRequests[];
}

/** A suborg record, as the rules read it: its name, its file and its quota as written. */
export interface SuborgFacts {
  name: string;
  file: string;
  /** spec.quota.requests, when the record carries both; the record's own check refuses the rest. */
  quota: { cpu: string; memory: string } | undefined;
  /** spec.quota.pods, when it is a whole number; read by the sizing judge (#1525). */
  pods?: number | undefined;
  /** spec.quota.storage, when it is written; read by the sizing judge as the ephemeral storage budget. */
  storage?: string | undefined;
}

export interface CrossFileRulesInput {
  environment: Environment;
  /** The environment's suborg directory, as a repository path, which the capacity messages name. */
  organizationsDirectory: string;
  services: readonly ServiceFacts[];
  suborgs: readonly SuborgFacts[];
  /** The app-sizing flag (#1525): on, each service is judged by its worst case instead of its declared requests. */
  sizing?: boolean;
}

export interface CrossFileRulesReport {
  /** Problems that fail kore validate, each naming its file and the fix. */
  errors: string[];
  /** Checks that could not judge, or that judged with a limit; they never fail validation. */
  warnings: string[];
}

/** A grant as `<suborg>/<service>`. */
interface Grant {
  suborg: string;
  service: string;
}

/** The grant an entry names, when it is `<suborg>/<service>` with two DNS labels. */
function parseGrant(entry: string): Grant | undefined {
  const parts = entry.split("/");
  if (parts.length !== 2) {
    return undefined;
  }
  const [suborg, service] = parts as [string, string];
  return dnsLabel.test(suborg) && dnsLabel.test(service)
    ? { suborg, service }
    : undefined;
}

/** A suborg's quota read to amounts, or undefined when either field cannot be read. */
function quotaAmount(quota: {
  cpu: string;
  memory: string;
}): Amount | undefined {
  const cpu = cpuMillis(quota.cpu);
  const memory = memoryMiB(quota.memory);
  return cpu === undefined || memory === undefined
    ? undefined
    : { cpuMillis: cpu, memoryMiB: memory };
}

/** A suborg's quota for the sizing judge, or undefined when a field it needs cannot be read. */
function sizingQuotaOf(suborg: SuborgFacts): SizingQuota | undefined {
  const amount =
    suborg.quota === undefined ? undefined : quotaAmount(suborg.quota);
  const ephemeral =
    suborg.storage === undefined ? undefined : memoryMiB(suborg.storage);
  if (
    amount === undefined ||
    ephemeral === undefined ||
    suborg.pods === undefined
  ) {
    return undefined;
  }
  return {
    name: suborg.name,
    file: suborg.file,
    cpuMillis: amount.cpuMillis,
    memoryMiB: amount.memoryMiB,
    ephemeralMiB: ephemeral,
    pods: suborg.pods,
  };
}

/** The request fields a record writes that cannot be read, each named with the form it must take. */
function requestFormErrors(service: ServiceFacts): string[] {
  const errors: string[] = [];
  for (const { component, cpu, memory } of service.requests) {
    const base = `${service.file}.spec.components.${component}.resources.requests`;
    if (cpu !== undefined && cpuMillis(cpu) === undefined) {
      errors.push(`${base}.cpu: must be a CPU quantity such as 500m or 1`);
    }
    if (memory !== undefined && memoryMiB(memory) === undefined) {
      errors.push(
        `${base}.memory: must be a memory quantity such as 512Mi or 1Gi`,
      );
    }
  }
  return errors;
}

/**
 * Whether the service's requests, summed over its components, fit the suborg's quota. A
 * request that cannot be read is left to requestFormErrors, so the sum is not judged.
 */
function quotaFitErrors(service: ServiceFacts, suborg: SuborgFacts): string[] {
  if (suborg.quota === undefined) {
    return [];
  }
  const quota = quotaAmount(suborg.quota);
  if (quota === undefined) {
    return [];
  }
  let cpu = 0;
  let memory = 0;
  for (const request of service.requests) {
    const requestCpu = request.cpu === undefined ? 0 : cpuMillis(request.cpu);
    const requestMemory =
      request.memory === undefined ? 0 : memoryMiB(request.memory);
    if (requestCpu === undefined || requestMemory === undefined) {
      return [];
    }
    cpu += requestCpu;
    memory += requestMemory;
  }
  const over: string[] = [];
  if (cpu > quota.cpuMillis) {
    over.push(
      `cpu ${formatCpu(cpu)} requested, quota ${formatCpu(quota.cpuMillis)}`,
    );
  }
  if (memory > quota.memoryMiB) {
    over.push(
      `memory ${formatMemory(memory)} requested, quota ${formatMemory(quota.memoryMiB)}`,
    );
  }
  return over.length === 0
    ? []
    : [
        `${service.file}.spec.components: the requests of ${service.name} exceed the quota of suborg ${suborg.name}: ${over.join("; ")}; lower the components' resources.requests or raise spec.quota in ${suborg.file}`,
      ];
}

/** A service of the environment with this name and a suborg, when there is one. */
const namedService = (services: readonly ServiceFacts[], name: string) =>
  services.find(
    (service) => service.name === name && service.organization !== undefined,
  );

/** A grant entry that is not `<suborg>/<service>`: a bare name is named with its suborg, anything else with the form. */
function malformedGrantError(
  entry: string,
  path: string,
  services: readonly ServiceFacts[],
): string {
  if (!entry.includes("/") && dnsLabel.test(entry)) {
    const holder = namedService(services, entry);
    const example =
      holder === undefined
        ? ""
        : `, for example "${holder.organization ?? ""}/${entry}"`;
    return `${path}: "${entry}" does not name its grantee's suborg: write it as <suborg>/<service>${example}`;
  }
  return `${path}: "${entry}" must name its grantee as <suborg>/<service>, both DNS labels`;
}

/**
 * The grants of one service: each entry names an existing service of the environment in the
 * suborg it names. A grant to the service itself is refused, and a grant to a sibling in the
 * same suborg is accepted (it adds nothing, but it is a real service).
 */
function grantErrors(
  service: ServiceFacts,
  services: readonly ServiceFacts[],
  environment: string,
): string[] {
  const path = `${service.file}.spec.allowFrom`;
  const own =
    service.organization === undefined
      ? undefined
      : `${service.organization}/${service.name}`;
  const errors: string[] = [];
  for (const entry of service.allowFrom) {
    const grant = parseGrant(entry);
    if (grant === undefined) {
      errors.push(malformedGrantError(entry, path, services));
      continue;
    }
    if (entry === own) {
      errors.push(
        `${path}: "${entry}" is this service: a service may not grant itself access; remove the entry`,
      );
      continue;
    }
    const exists = services.some(
      (candidate) =>
        candidate.organization === grant.suborg &&
        candidate.name === grant.service,
    );
    if (exists) {
      continue;
    }
    const elsewhere = namedService(services, grant.service);
    const hint =
      elsewhere === undefined
        ? ""
        : `, or write the suborg the service is in, which is ${elsewhere.organization}/${grant.service}`;
    errors.push(
      `${path}: "${entry}" is not a service of environment ${environment} in suborg ${grant.suborg}: a grant needs an existing service there; remove the entry if the service was removed${hint}`,
    );
  }
  return errors;
}

/** Whether a service's suborg is one the environment declares, when it names one that is not platform. */
function organizationErrors(
  service: ServiceFacts,
  suborgs: ReadonlySet<string>,
  environment: string,
  organizationsDirectory: string,
): string[] {
  const organization = service.organization;
  if (
    organization === undefined ||
    organization === platform ||
    suborgs.has(organization)
  ) {
    return [];
  }
  return [
    `${service.file}.spec.organization: "${organization}" is not a suborg of environment ${environment}: create ${organizationsDirectory}/${organization}.json, or name an existing suborg (platform is the tenant root)`,
  ];
}

/**
 * The capacity verdict on the suborg quotas. A sum is judged only when a suborg carries a
 * readable quota; the verdict comes from the shared capacityFit, and this names it.
 */
function capacityReport(input: CrossFileRulesInput): CrossFileRulesReport {
  const { environment, organizationsDirectory } = input;
  const quotas = input.suborgs
    .map((suborg) =>
      suborg.quota === undefined ? undefined : quotaAmount(suborg.quota),
    )
    .filter((amount): amount is Amount => amount !== undefined);
  if (quotas.length === 0) {
    return { errors: [], warnings: [] };
  }
  const budget = nodeBudget(environment);
  const fraction = committedFraction(environment);
  const fit = capacityFit({ quotas, budget, committedFraction: fraction });
  const name = environment.name;
  if (fit.status === "unjudged") {
    const missing = fit.missing;
    return {
      errors: [],
      warnings: [
        `${organizationsDirectory}: the suborg quotas are not checked against the capacity of environment ${name}: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not declared (ADR 0152), so the sum is not judged`,
      ],
    };
  }
  if (fit.status === "over") {
    const nodes = budget.judged ? budget.nodes : 0;
    const parts = fit.over.map((over) => {
      const format = over.dimension === "cpu" ? formatCpu : formatMemory;
      return `${over.dimension} ${format(over.requested)} against ${format(over.allowed)}`;
    });
    const who = fit.platformSubtracted
      ? "the suborg quotas and the platform's requests"
      : "the suborg quotas";
    return {
      errors: [
        `${organizationsDirectory}: ${who} together exceed what environment ${name} can commit: ${parts.join("; ")} (allocatable × ${nodes} ${nodes === 1 ? "node" : "nodes"} × committedFraction ${fraction}); lower a suborg's spec.quota or declare more capacity (ADR 0152)`,
      ],
      warnings: [],
    };
  }
  return {
    errors: [],
    warnings: fit.platformSubtracted
      ? []
      : [
          `${organizationsDirectory}: the suborg quotas fit the committed share of environment ${name}'s capacity, but the platform's pod requests are not yet subtracted, so the capacity budget is not fully judged (ADR 0152)`,
        ],
  };
}

/**
 * The cross-file problems of one environment: the suborg a service names, its grants, its
 * requests against its suborg's quota, and the suborg quotas against the environment's capacity.
 */
export function crossFileRules(
  input: CrossFileRulesInput,
): CrossFileRulesReport {
  const { environment, organizationsDirectory, services, suborgs } = input;
  const suborgNames = new Set(suborgs.map((suborg) => suborg.name));
  const suborgByName = new Map(suborgs.map((suborg) => [suborg.name, suborg]));
  const errors: string[] = [];
  for (const service of services) {
    errors.push(...requestFormErrors(service));
    errors.push(
      ...organizationErrors(
        service,
        suborgNames,
        environment.name,
        organizationsDirectory,
      ),
    );
    const suborg =
      service.organization === undefined
        ? undefined
        : suborgByName.get(service.organization);
    if (input.sizing === true) {
      const quota = suborg === undefined ? undefined : sizingQuotaOf(suborg);
      errors.push(...renderSizing(service, quota).errors);
    } else if (suborg !== undefined) {
      errors.push(...quotaFitErrors(service, suborg));
    }
    errors.push(...grantErrors(service, services, environment.name));
  }
  const capacity = capacityReport(input);
  return {
    errors: [...errors, ...capacity.errors],
    warnings: capacity.warnings,
  };
}
