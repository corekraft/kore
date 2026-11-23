import type { K3dCluster, Repository } from "../config/index.js";
import { driftListingMappingsFlag, featureEnabled } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  listingReportsMappings,
  type PortMappings,
  unreadablePorts,
} from "./k3d-drift.js";

/** The name k3d gives a cluster's load balancer container. */
export function loadBalancerContainer(clusterName: string): string {
  return `k3d-${clusterName}-serverlb`;
}

/**
 * The load balancer's port bindings as docker inspect reports them: the second
 * source for host addresses when `k3d cluster list` omits them. Read-only.
 * Undefined when the container cannot be inspected, so the caller names the gap.
 */
export async function inspectPortMappings(
  runner: Runner,
  clusterName: string,
): Promise<PortMappings | undefined> {
  const args = [
    "inspect",
    "--format",
    "{{json .NetworkSettings.Ports}}",
    loadBalancerContainer(clusterName),
  ];
  let stdout: string;
  try {
    ({ stdout } = await runner.run("docker", args, { capture: true }));
  } catch (error) {
    if (error instanceof CommandError) {
      return undefined;
    }
    throw error;
  }
  let mappings: unknown;
  try {
    mappings = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `docker ${args.join(" ")} printed unreadable output, not JSON: ${stdout.slice(0, 80)}`,
      { cause: error },
    );
  }
  return (mappings ?? {}) as PortMappings;
}

/**
 * Whether docker inspect is read for a cluster's listing: when the listing omits an
 * address, or, with the drift-listing-mappings flag on, when it reports no mappings
 * at all (#1683). Otherwise the listing alone decides, as before.
 */
export function inspectionNeeded(
  repository: Repository,
  entry: Record<string, unknown>,
  cluster: K3dCluster,
): boolean {
  const missingMappings =
    featureEnabled(repository.environment, driftListingMappingsFlag) &&
    !listingReportsMappings(entry);
  return missingMappings || unreadablePorts(entry, cluster).length > 0;
}
