import {
  loadRepository,
  platformPlan,
  type Repository,
} from "../src/config/index.js";

type Environment = Repository["environment"];

/**
 * The host port the retired local registry port-forward served. It is not an
 * overlay field: the legacy stop still matches it as a literal, so it stays
 * written once here.
 */
const registryPort = 30500;

/** The names and ports the local overlay gives the platform. */
export interface LocalPlatform {
  /** platform.domain, for example the default local domain. */
  domain: string;
  /** The registry's name under the platform domain, without a port. */
  registryHost: string;
  /** The registry's name and forward port, as a pinned reference prefix. */
  registry: string;
  /** The host port the retired registry port-forward served; the legacy stop still matches it. */
  registryPort: number;
  /** The registry's name under the platform organization, which host-side callers dial (ADR 0132). */
  registryName: string;
  /** gateway.port: the port the platform Gateway serves on. */
  gatewayPort: number;
  /** The first k3d host port the overlay publishes. */
  hostPort: number;
}

/** The platform names and ports an environment declares. */
export function platformOf(environment: Environment): LocalPlatform {
  const { domain, organizationId } = platformPlan(environment);
  const hostPort = environment.k3d?.ports[0]?.hostPort;
  if (hostPort === undefined) {
    throw new Error(
      `environment ${environment.name} publishes no k3d host port; the integration specs read it from environment.k3d.ports`,
    );
  }
  return {
    domain,
    registryHost: `registry.${domain}`,
    registry: `registry.${domain}:${registryPort}`,
    registryPort,
    registryName: `registry.${organizationId}.${domain}`,
    gatewayPort: environment.gateway.port,
    hostPort,
  };
}

/** The platform names and ports of the repository's local overlay. */
export async function localPlatform(start?: string): Promise<LocalPlatform> {
  return platformOf((await loadRepository("local", start)).environment);
}

/** Escapes text so a platform name can sit inside a regular expression. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
