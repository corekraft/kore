import type { K3dCluster } from "../config/index.js";

/** One host binding the load balancer publishes: its host address and host port. */
interface PublishedBinding {
  address: string;
  port: string;
}

/**
 * Host bindings the load balancer publishes, by container port; undefined when
 * not reported. A binding whose host address the list omits reads as
 * `unreported`, which never equals a configured address.
 */
function publishedPorts(
  entry: Record<string, unknown>,
): Map<string, PublishedBinding[]> | undefined {
  const nodes = (entry["nodes"] ?? []) as Record<string, unknown>[];
  const mappings = nodes.find((node) => node["role"] === "loadbalancer")?.[
    "portMappings"
  ] as
    Record<string, { HostIp?: string; HostPort?: string }[] | null> | undefined;
  if (mappings === undefined) {
    return undefined;
  }
  return new Map(
    Object.entries(mappings).map(([container, bindings]) => [
      container.replace(/\/\w+$/, ""),
      (bindings ?? []).map((binding) => ({
        address: binding.HostIp || "unreported",
        port: String(binding.HostPort),
      })),
    ]),
  );
}

/**
 * How an existing cluster differs from the overlay. Counts always compare;
 * each declared port must be published on its host port, bound to its host
 * address, when k3d's entry reports mappings. A port published on the right
 * host port at another address is an address difference (ADR 0131). Extra
 * mappings (k3d publishes the API port on a random host port) are ignored.
 * The service CIDR is not compared: k3d's list does not report it in a form
 * confirmed live (gap for the live proof, #149).
 */
export function drift(
  entry: Record<string, unknown>,
  cluster: K3dCluster,
): string[] {
  const differences: string[] = [];
  const compare = (name: string, actual: unknown, wanted: unknown): void => {
    if (String(actual) !== String(wanted)) {
      differences.push(`${name}: ${String(actual)} != ${String(wanted)}`);
    }
  };
  compare("servers", entry["serversCount"], cluster.servers ?? 1);
  compare("agents", entry["agentsCount"], cluster.agents ?? 0);
  const published = publishedPorts(entry);
  if (published !== undefined) {
    for (const port of cluster.ports) {
      const bindings = published.get(String(port.loadBalancerPort)) ?? [];
      const onPort = bindings.filter(
        (binding) => binding.port === String(port.hostPort),
      );
      if (onPort.length === 0) {
        compare(
          `port ${port.loadBalancerPort}`,
          bindings.length
            ? bindings.map((binding) => binding.port).join(",")
            : "unmapped",
          port.hostPort,
        );
      } else if (
        !onPort.some((binding) => binding.address === port.hostAddress)
      ) {
        compare(
          `port ${port.loadBalancerPort} address`,
          onPort.map((binding) => binding.address).join(","),
          port.hostAddress,
        );
      }
    }
  }
  return differences;
}
