import type { Repository } from "./types.js";

export const registryPort = 5000;

const cidrPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function octetsToInt(parts: string[]): number | undefined {
  const octets = parts.map(Number);
  return octets.some((o) => o > 255)
    ? undefined
    : octets.reduce((acc, o) => acc * 256 + o, 0);
}

function parseCidr(cidr: string): { base: number; size: number } | undefined {
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

/**
 * The oci-registry values pin the Service ClusterIP; this is the one place the
 * address is chosen. The service range and the image policy globs are checked
 * against it so a disagreement fails validation instead of admission.
 */
export function registryAddressErrors(repository: Repository): string[] {
  const { environment, registryClusterIP: ip } = repository;
  const cidrText = (
    environment.cluster as Repository["environment"]["cluster"] | undefined
  )?.serviceCidr;
  const cidr = cidrText === undefined ? undefined : parseCidr(cidrText);
  return [
    ...(cidrText !== undefined && cidr === undefined
      ? [
          `cluster.serviceCidr must be an IPv4 CIDR such as 10.96.0.0/12, got ${cidrText}`,
        ]
      : []),
    ...(ip === undefined
      ? []
      : [
          ...(cidrText === undefined && environment.cluster !== undefined
            ? [
                `oci-registry pins service.clusterIP ${ip}; set cluster.serviceCidr in environment ${environment.name} so Minikube is started with a range that contains it`,
              ]
            : []),
          ...(cidr !== undefined && !inRange(ip, cidr)
            ? [
                `oci-registry service.clusterIP ${ip} is outside cluster.serviceCidr ${cidrText}; change service.clusterIP (and the image policy glob) to an address inside the range`,
              ]
            : []),
          ...registryGlobErrors(repository, `${ip}:${registryPort}`),
        ]),
  ];
}

function registryGlobErrors(repository: Repository, address: string): string[] {
  const images = (
    repository.imageTrustValues?.["trust"] as { images?: unknown } | undefined
  )?.images;
  return (Array.isArray(images) ? images : [])
    .filter((glob): glob is string => typeof glob === "string")
    .filter((glob) => glob.split("/")[0] !== address)
    .map(
      (glob) =>
        `image trust: images glob ${glob} must name the registry address ${address} pinned by oci-registry service.clusterIP; update the glob or the pin so they agree`,
    );
}
