// Refuses an existing k3d cluster whose listing, and docker inspect where the listing
// omits its mappings, disagree with the overlay, before anything is written (ADR 0131,
// #1683). Read-only.
import type { Environment, K3dCluster } from "../config/index.js";
import { driftListingMappingsFlag, featureEnabled } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  differsMessage,
  drift,
  listingReportsMappings,
  type PortMappings,
  unmappedMessage,
  unreadableMessage,
  unreadablePorts,
} from "./k3d-drift.js";
import { inspectPortMappings, loadBalancerContainer } from "./k3d-inspect.js";

/**
 * The load balancer's bindings from docker inspect: read when the listing omits an
 * address, or, with the drift-listing-mappings flag on, when it reports no mappings at
 * all. With the flag on, a listing with no mappings and no docker inspect is refused,
 * naming the gap, since nothing can then be checked (#1683).
 */
async function listingMappings(
  runner: Runner,
  cluster: K3dCluster,
  entry: Record<string, unknown>,
  mappingsFlag: boolean,
): Promise<PortMappings | undefined> {
  const missing = mappingsFlag && !listingReportsMappings(entry);
  if (!missing && unreadablePorts(entry, cluster).length === 0) {
    return undefined;
  }
  const inspected = await inspectPortMappings(runner, cluster.clusterName);
  if (missing && inspected === undefined) {
    throw new Error(
      unmappedMessage(
        cluster.clusterName,
        loadBalancerContainer(cluster.clusterName),
      ),
    );
  }
  return inspected;
}

/**
 * Refuses an existing cluster that differs from the overlay: a host address nothing
 * reports, or a difference in its mappings or counts. The drift-listing-mappings flag
 * decides whether the listing's missing mappings are read from docker inspect, and
 * whether a difference names the feature flag that publishes its port.
 */
export async function refuseDrift(
  runner: Runner,
  environment: Environment,
  cluster: K3dCluster,
  entry: Record<string, unknown>,
): Promise<void> {
  const { clusterName } = cluster;
  const mappingsFlag = featureEnabled(environment, driftListingMappingsFlag);
  const inspected = await listingMappings(runner, cluster, entry, mappingsFlag);
  const unreadable = unreadablePorts(entry, cluster, inspected);
  if (unreadable.length > 0) {
    throw new Error(
      unreadableMessage(
        clusterName,
        loadBalancerContainer(clusterName),
        unreadable,
        mappingsFlag,
      ),
    );
  }
  const differences = drift(entry, cluster, inspected, mappingsFlag);
  if (differences.length > 0) {
    throw new Error(differsMessage(clusterName, differences));
  }
}
