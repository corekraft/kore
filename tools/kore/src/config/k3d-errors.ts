import { parseCidr } from "./registry-address.js";
import type { Environment, Versions } from "./types.js";

const clusterName = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const knownFields = new Set([
  "clusterName",
  "serviceCidr",
  "ports",
  "servers",
  "agents",
]);
const digestPinned = /^[^\s@]+@sha256:[a-f0-9]{64}$/;

const isPort = (value: unknown): boolean =>
  Number.isInteger(value) &&
  (value as number) >= 1 &&
  (value as number) <= 65535;

function integerAtLeast(value: unknown, minimum: number): boolean {
  return Number.isInteger(value) && (value as number) >= minimum;
}

function clusterNameErrors(value: unknown): string[] {
  if (typeof value !== "string" || value === "") {
    return ["environment.k3d.clusterName is required"];
  }
  return clusterName.test(value)
    ? []
    : [
        `environment.k3d.clusterName must be lowercase letters, digits and hyphens, starting and ending alphanumeric, got ${value}`,
      ];
}

function serviceCidrErrors(value: unknown): string[] {
  if (typeof value !== "string" || value === "") {
    return ["environment.k3d.serviceCidr is required"];
  }
  return parseCidr(value)
    ? []
    : [
        `environment.k3d.serviceCidr must be an IPv4 CIDR such as 10.96.0.0/12, got ${value}`,
      ];
}

function fieldErrors(k3d: Record<string, unknown>): string[] {
  return [
    ...Object.keys(k3d)
      .filter((key) => !knownFields.has(key))
      .map((key) =>
        key === "image"
          ? "environment.k3d.image is not configurable; the k3s image comes from versions.images.k3s"
          : `environment.k3d.${key} is not a k3d field; use clusterName, serviceCidr, ports, servers or agents`,
      ),
    ...clusterNameErrors(k3d["clusterName"]),
    ...serviceCidrErrors(k3d["serviceCidr"]),
    ...(k3d["servers"] !== undefined && !integerAtLeast(k3d["servers"], 1)
      ? ["environment.k3d.servers must be an integer of at least 1"]
      : []),
    ...(k3d["agents"] !== undefined && !integerAtLeast(k3d["agents"], 0)
      ? ["environment.k3d.agents must be an integer of at least 0"]
      : []),
    ...portErrors(k3d["ports"]),
  ];
}

function portErrors(ports: unknown): string[] {
  if (!Array.isArray(ports) || ports.length === 0) {
    return [
      "environment.k3d.ports must be a non-empty list of { hostPort, loadBalancerPort }",
    ];
  }
  const seen = new Set<unknown>();
  const duplicates = new Set<unknown>();
  const errors = ports.flatMap((entry: unknown, index) => {
    const port = (entry ?? {}) as Record<string, unknown>;
    if (seen.has(port["hostPort"])) {
      duplicates.add(port["hostPort"]);
    }
    seen.add(port["hostPort"]);
    return (["hostPort", "loadBalancerPort"] as const)
      .filter((key) => !isPort(port[key]))
      .map(
        (key) =>
          `environment.k3d.ports[${index}].${key} must be an integer from 1 to 65535`,
      );
  });
  return [
    ...errors,
    ...[...duplicates]
      .filter(isPort)
      .map(
        (host) => `environment.k3d.ports maps host port ${String(host)} twice`,
      ),
  ];
}

/**
 * Schema errors for the provider-specific cluster block, found before any
 * cluster is touched. A k3d overlay carries `k3d`, never a managed environment's `cluster`;
 * every other provider carries no `k3d` block.
 */
export function k3dErrors(
  environment: Environment,
  versions: Versions,
): string[] {
  const k3d: unknown = environment.k3d;
  if (environment.provider !== "k3d") {
    return k3d === undefined
      ? []
      : [
          `environment.k3d is only valid when provider is k3d, not ${String(environment.provider)}; remove it`,
        ];
  }
  const name = (k3d as { clusterName?: unknown } | undefined)?.clusterName;
  const expected = `k3d-${String(name)}`;
  return [
    ...(environment.cluster === undefined
      ? []
      : [
          "environment.cluster is only valid for provider managed; remove it and use environment.k3d for provider k3d",
        ]),
    ...(!k3d || typeof k3d !== "object" || Array.isArray(k3d)
      ? ["environment.k3d is required when provider is k3d"]
      : fieldErrors(k3d as Record<string, unknown>)),
    ...(typeof name === "string" &&
    clusterName.test(name) &&
    environment.kubeContext &&
    environment.kubeContext !== expected
      ? [
          `environment.kubeContext must be ${expected} for k3d cluster ${name}, got ${environment.kubeContext}`,
        ]
      : []),
    ...(digestPinned.test(versions.images?.["k3s"] ?? "")
      ? []
      : ["versions.images.k3s must be a digest-pinned image for provider k3d"]),
  ];
}
