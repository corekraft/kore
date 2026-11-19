import type { K3dCluster } from "../config/index.js";

type K3dPort = K3dCluster["ports"][number];

/** One host binding docker reports for a published port. */
export interface Binding {
  HostIp?: string;
  HostPort?: string;
}

/** Port mappings as `k3d cluster list` and `docker inspect` report them: container port to its host bindings. */
export type PortMappings = Record<string, Binding[] | null>;

/** The load balancer's port mappings in a `k3d cluster list` entry; undefined when the entry reports none. */
function listedMappings(
  entry: Record<string, unknown>,
): PortMappings | undefined {
  const nodes = (entry["nodes"] ?? []) as Record<string, unknown>[];
  return nodes.find((node) => node["role"] === "loadbalancer")?.[
    "portMappings"
  ] as PortMappings | undefined;
}

/** Every binding under a declared port's container port, whatever its host port. */
function bindingsUnder(
  mappings: PortMappings | undefined,
  port: K3dPort,
): Binding[] {
  return Object.entries(mappings ?? {})
    .filter(
      ([container]) =>
        container.replace(/\/\w+$/, "") === String(port.loadBalancerPort),
    )
    .flatMap(([, bindings]) => bindings ?? []);
}

/** The bindings a declared port publishes on its declared host port. */
function bindingsOn(
  mappings: PortMappings | undefined,
  port: K3dPort,
): Binding[] {
  return bindingsUnder(mappings, port).filter(
    (binding) => String(binding.HostPort) === String(port.hostPort),
  );
}

/** A binding's host address: the listing's, else the one docker inspect reports for the same host port. */
function addressOf(
  binding: Binding,
  port: K3dPort,
  inspected: PortMappings | undefined,
): string | undefined {
  return (
    binding.HostIp || bindingsOn(inspected, port).find((b) => b.HostIp)?.HostIp
  );
}

/**
 * The declared ports whose published host address neither the listing nor the
 * docker inspect bindings report. A declared port the listing does not publish
 * on its host port is a port difference for `drift`, not an unreadable address.
 */
export function unreadablePorts(
  entry: Record<string, unknown>,
  cluster: K3dCluster,
  inspected?: PortMappings,
): K3dPort[] {
  const listed = listedMappings(entry);
  return cluster.ports.filter((port) =>
    bindingsOn(listed, port).some(
      (binding) => addressOf(binding, port, inspected) === undefined,
    ),
  );
}

/**
 * How an existing cluster differs from the overlay. Counts always compare;
 * each declared port must be published on its host port, bound to its host
 * address, when k3d's entry reports mappings. A port published on the right
 * host port at another address is an address difference (ADR 0131). Extra
 * mappings (k3d publishes the API port on a random host port) are ignored.
 * The service CIDR is not compared: k3d's list does not report it in a form
 * confirmed live (gap for the live proof, #149). Callers refuse
 * `unreadablePorts` first, so every address compared here is known.
 */
export function drift(
  entry: Record<string, unknown>,
  cluster: K3dCluster,
  inspected?: PortMappings,
): string[] {
  const differences: string[] = [];
  const compare = (name: string, actual: unknown, wanted: unknown): void => {
    if (String(actual) !== String(wanted)) {
      differences.push(`${name}: ${String(actual)} != ${String(wanted)}`);
    }
  };
  compare("servers", entry["serversCount"], cluster.servers ?? 1);
  compare("agents", entry["agentsCount"], cluster.agents ?? 0);
  const listed = listedMappings(entry);
  if (listed !== undefined) {
    for (const port of cluster.ports) {
      const under = bindingsUnder(listed, port);
      const onPort = bindingsOn(listed, port);
      if (onPort.length === 0) {
        compare(
          `port ${port.loadBalancerPort}`,
          under.length
            ? under.map((binding) => String(binding.HostPort)).join(",")
            : "unmapped",
          port.hostPort,
        );
      } else {
        const addresses = onPort.map(
          (binding) => addressOf(binding, port, inspected) ?? "unreported",
        );
        if (!addresses.includes(port.hostAddress)) {
          compare(
            `port ${port.loadBalancerPort} address`,
            addresses.join(","),
            port.hostAddress,
          );
        }
      }
    }
  }
  return differences;
}

/**
 * The refusal when no source reports a published port's host address. It names
 * both commands that were read, and it never says to recreate the cluster,
 * which cannot change what k3d and Docker report.
 */
export function unreadableMessage(
  clusterName: string,
  container: string,
  ports: readonly K3dPort[],
): string {
  const names = ports.map((port) => `port ${port.loadBalancerPort}`).join(", ");
  return `k3d cluster ${clusterName} does not report the host address of ${names} in \`k3d cluster list --output json\` or \`docker inspect ${container}\`; it cannot be checked against the overlay, and recreating the cluster does not change that. Check that k3d and Docker report the load balancer's port bindings.`;
}
