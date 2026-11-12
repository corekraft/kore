import type { Environment, Repository } from "./types.js";

/** Port the in-cluster registry listens on when the address names none. */
export const defaultRegistryPort = "5000";

/** Components that receive the registry address as a platform value. */
export const registryConsumers = ["oci-registry", "kore-image-policy"];

const cidrPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function octetsToInt(parts: string[]): number | undefined {
  const octets = parts.map(Number);
  return octets.some((o) => o > 255)
    ? undefined
    : octets.reduce((acc, o) => acc * 256 + o, 0);
}

export function parseCidr(
  cidr: string,
): { base: number; size: number } | undefined {
  const match = cidrPattern.exec(cidr);
  const prefix = Number(match?.[5]);
  const base = match ? octetsToInt(match.slice(1, 5)) : undefined;
  return match && base !== undefined && prefix <= 32
    ? { base, size: 2 ** (32 - prefix) }
    : undefined;
}

function inRange(ip: string, cidr: { base: number; size: number }): boolean {
  const match = ipPattern.exec(ip);
  const value = match ? octetsToInt(match.slice(1)) : undefined;
  if (value === undefined) {
    return false;
  }
  const start = Math.floor(cidr.base / cidr.size) * cidr.size;
  return value >= start && value < start + cidr.size;
}

export interface RegistryPlan {
  /** The environment's registry.address, verbatim: the single source of truth. */
  address: string;
  host: string;
  port?: string;
  /**
   * Set when the address is an IPv4 literal: the environment provides the
   * in-cluster registry and its Service is pinned to this ClusterIP.
   */
  clusterIP?: string;
}

const addressPattern =
  /^(?<host>[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::(?<port>\d{1,5}))?$/;

function parseAddress(address: unknown): RegistryPlan | undefined {
  const groups =
    typeof address === "string"
      ? addressPattern.exec(address)?.groups
      : undefined;
  const host = groups?.["host"];
  if (typeof address !== "string" || host === undefined) {
    return undefined;
  }
  const port = groups?.["port"];
  return {
    address,
    host,
    ...(port === undefined ? {} : { port }),
    ...(ipPattern.test(host) ? { clusterIP: host } : {}),
  };
}

/** Derives everything registry-shaped from the environment's one address. */
export function registryPlan(environment: Environment): RegistryPlan {
  const plan = parseAddress(
    (environment as { registry?: { address?: unknown } }).registry?.address,
  );
  if (!plan) {
    throw new Error(
      `environment ${environment.name} must declare registry.address as host[:port]`,
    );
  }
  return plan;
}

/**
 * Helm arguments that hand the registry address to a consuming component: the
 * platform value every chart reads, plus the Service pin and port the local
 * registry chart derives from an in-cluster address.
 */
export function registryHelmArgs(
  environment: Environment,
  component?: string,
): string[] {
  const plan = registryPlan(environment);
  return [
    "--set-string",
    `platform.registry.address=${plan.address}`,
    ...(component === "kore-image-policy" && environment.platformMirror
      ? [
          "--set-string",
          `platform.mirror.repository=${environment.platformMirror}`,
        ]
      : []),
    ...(component === "oci-registry" && plan.clusterIP !== undefined
      ? [
          "--set-string",
          `service.clusterIP=${plan.clusterIP}`,
          "--set-string",
          `service.port=${plan.port ?? defaultRegistryPort}`,
        ]
      : []),
  ];
}

const forbiddenPaths: Record<string, string[][]> = {
  "oci-registry": [
    ["service", "clusterIP"],
    ["service", "port"],
  ],
  "kore-image-policy": [["trust", "images"]],
};

function valueAt(values: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      node && typeof node === "object"
        ? (node as Record<string, unknown>)[key]
        : undefined,
    values,
  );
}

function strings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  return value && typeof value === "object"
    ? Object.values(value).flatMap(strings)
    : [];
}

function hardcodedErrors(repository: Repository, host: string): string[] {
  return Object.entries(repository.registryComponentValues ?? {}).flatMap(
    ([component, values]) => [
      ...(forbiddenPaths[component] ?? [])
        .filter((path) => valueAt(values, path) !== undefined)
        .map(
          (path) =>
            `${component} values must not set ${path.join(".")}; it is derived from registry.address in environment ${repository.environment.name}`,
        ),
      ...(strings(values).some((text) => text.includes(host))
        ? [
            `${component} values hardcode the registry host ${host}; remove it, registry.address in environment ${repository.environment.name} is the only place it is written`,
          ]
        : []),
    ],
  );
}

/**
 * registry.address is the one place the registry location is chosen. An IPv4
 * address means the environment provides the in-cluster registry, so it must
 * lie inside the Minikube service range; a hostname pins nothing.
 */
export function registryAddressErrors(repository: Repository): string[] {
  const { environment } = repository;
  const k3d = environment.provider === "k3d";
  const cidrField = k3d ? "k3d.serviceCidr" : "cluster.serviceCidr";
  const cidrText = k3d
    ? environment.k3d?.serviceCidr
    : (environment.cluster as Repository["environment"]["cluster"] | undefined)
        ?.serviceCidr;
  const cidr = cidrText === undefined ? undefined : parseCidr(cidrText);
  const declared = (environment as { registry?: { address?: unknown } })
    .registry?.address;
  const plan = parseAddress(declared);
  return [
    ...(cidrText !== undefined && cidr === undefined
      ? [
          `${cidrField} must be an IPv4 CIDR such as 10.96.0.0/12, got ${cidrText}`,
        ]
      : []),
    ...(plan === undefined
      ? [
          `registry.address must be host[:port] (for example 10.96.0.50:5000 or registry.example.internal) in environment ${environment.name}, got ${JSON.stringify(declared)}`,
        ]
      : [
          ...(plan.clusterIP !== undefined &&
          cidrText === undefined &&
          environment.cluster !== undefined &&
          !k3d
            ? [
                `registry.address ${plan.address} is an in-cluster ClusterIP; set cluster.serviceCidr in environment ${environment.name} so Minikube is started with a range that contains it`,
              ]
            : []),
          ...(plan.clusterIP !== undefined &&
          cidr !== undefined &&
          !inRange(plan.clusterIP, cidr)
            ? [
                `registry.address ${plan.address} is outside ${cidrField} ${cidrText}; change registry.address to an address inside the range`,
              ]
            : []),
          ...hardcodedErrors(repository, plan.host),
        ]),
  ];
}
