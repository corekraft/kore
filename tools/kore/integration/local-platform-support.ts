import {
  loadRepository,
  platformPlan,
  type Repository,
} from "../src/config/index.js";

type Environment = Repository["environment"];

/**
 * The host port the local registry port-forward serves. It is not an overlay
 * field: the images domain dials it as a literal, so it stays written once here.
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
  /** The host port the registry port-forward answers on. */
  registryPort: number;
  /** The loopback address the registry port-forward answers on. */
  registryForward: string;
  /** gateway.port: the port the platform Gateway serves on. */
  gatewayPort: number;
  /** The first k3d host port the overlay publishes. */
  hostPort: number;
}

/** The platform names and ports an environment declares. */
export function platformOf(environment: Environment): LocalPlatform {
  const { domain } = platformPlan(environment);
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
    registryForward: `127.0.0.1:${registryPort}`,
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
