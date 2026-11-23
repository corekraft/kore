import type { K3dCluster } from "../config/index.js";

type K3dPort = K3dCluster["ports"][number];

/** The container port the k3s API listens on through the load balancer. */
const apiContainerPort = 6443;

/** One host binding docker reports for a published port. */
export interface Binding {
  HostIp?: string;
  HostPort?: string;
}

/** Port mappings as `k3d cluster list` and `docker inspect` report them: container port to its host bindings. */
export type PortMappings = Record<string, Binding[] | null>;

/**
 * A port the overlay wants published on a host address. A declared port has a
 * host port; the API port has none, because k3d chooses it at random. A port
 * without a protocol is TCP.
 */
export interface Published {
  loadBalancerPort: number;
  hostAddress: string;
  hostPort?: number;
  protocol?: K3dPort["protocol"];
  featureFlag?: string;
}

/**
 * The host address the API port binds: the first declared port's, so one
 * overlay address serves every loopback binding (ADR 0131). The overlay schema
 * requires at least one declared port.
 */
export function apiHostAddress(cluster: K3dCluster): string {
  const first = cluster.ports[0];
  if (first === undefined) {
    throw new Error(
      "environment.k3d.ports declares no port, so the API port has no host address to bind; declare a loopback port",
    );
  }
  return first.hostAddress;
}

/** Every port the overlay wants published: the declared ports, then the API port. */
export function publishedPorts(cluster: K3dCluster): Published[] {
  return [
    ...cluster.ports,
    {
      loadBalancerPort: apiContainerPort,
      hostAddress: apiHostAddress(cluster),
    },
  ];
}

/** The load balancer's port mappings in a `k3d cluster list` entry; undefined when the entry reports none. */
function listedMappings(
  entry: Record<string, unknown>,
): PortMappings | undefined {
  const nodes = (entry["nodes"] ?? []) as Record<string, unknown>[];
  return nodes.find((node) => node["role"] === "loadbalancer")?.[
    "portMappings"
  ] as PortMappings | undefined;
}

/**
 * Whether `k3d cluster list` reports the load balancer's port mappings at all.
 * When it does not, docker inspect is the only source of them, so the caller
 * must read it before it can say whether a declared port is published.
 */
export function listingReportsMappings(
  entry: Record<string, unknown>,
): boolean {
  return listedMappings(entry) !== undefined;
}

/** The bindings to compare: the listing's, else docker inspect's when the listing reports none. */
function mappingsOf(
  entry: Record<string, unknown>,
  inspected: PortMappings | undefined,
): PortMappings | undefined {
  return listedMappings(entry) ?? inspected;
}

/** A mapping's transport: TCP unless it says otherwise. */
function protocolOf(port: Published): string {
  return port.protocol ?? "tcp";
}

/**
 * How a published port is named in a difference: UDP ports carry their protocol.
 * With `namedFlags` (the drift-listing-mappings flag is on), a port that names a
 * feature flag also names it, so the difference says what publishes the mapping.
 */
function labelOf(port: Published, namedFlags: boolean): string {
  const name =
    port.protocol === "udp"
      ? `port ${port.loadBalancerPort}/udp`
      : `port ${port.loadBalancerPort}`;
  return namedFlags && port.featureFlag !== undefined
    ? `${name} (${port.featureFlag})`
    : name;
}

/** Every binding under a published port's container port and protocol, whatever its host port. */
function bindingsUnder(
  mappings: PortMappings | undefined,
  port: Published,
): Binding[] {
  return Object.entries(mappings ?? {})
    .filter(([container]) => {
      const [number, protocol = "tcp"] = container.split("/");
      return (
        number === String(port.loadBalancerPort) &&
        protocol === protocolOf(port)
      );
    })
    .flatMap(([, bindings]) => bindings ?? []);
}

/** The bindings a published port occupies: on its host port when it declares one, else any under its container port. */
function bindingsOn(
  mappings: PortMappings | undefined,
  port: Published,
): Binding[] {
  return bindingsUnder(mappings, port).filter(
    (binding) =>
      port.hostPort === undefined ||
      String(binding.HostPort) === String(port.hostPort),
  );
}

/** A binding's host address: the listing's, else the one docker inspect reports for the same container and host port. */
function addressOf(
  binding: Binding,
  port: Published,
  inspected: PortMappings | undefined,
): string | undefined {
  return (
    binding.HostIp ||
    bindingsUnder(inspected, port)
      .filter((b) => String(b.HostPort) === String(binding.HostPort))
      .find((b) => b.HostIp)?.HostIp
  );
}

/**
 * The published ports whose host address neither the listing nor the docker
 * inspect bindings report. A declared port the listing does not publish on its
 * host port is a port difference for `drift`, not an unreadable address.
 */
export function unreadablePorts(
  entry: Record<string, unknown>,
  cluster: K3dCluster,
  inspected?: PortMappings,
): Published[] {
  const mappings = mappingsOf(entry, inspected);
  return publishedPorts(cluster).filter((port) =>
    bindingsOn(mappings, port).some(
      (binding) => addressOf(binding, port, inspected) === undefined,
    ),
  );
}

/**
 * How an existing cluster differs from the overlay. Counts always compare;
 * each declared port must be published on its host port, bound to its host
 * address, when k3d's entry reports mappings. A port published on the right
 * host port at another address is an address difference (ADR 0131). The API
 * port is compared on its address only, since k3d chooses its host port at
 * random; a port published on any other address is refused. Other extra
 * mappings are ignored. The service CIDR is not compared: k3d's list does not
 * report it in a form confirmed live (gap for the live proof, #149). Callers
 * refuse `unreadablePorts` first, so every address compared here is known.
 * `namedFlags` names the feature flag that publishes a differing port (#1683).
 */
export function drift(
  entry: Record<string, unknown>,
  cluster: K3dCluster,
  inspected?: PortMappings,
  namedFlags = false,
): string[] {
  const differences: string[] = [];
  const compare = (name: string, actual: unknown, wanted: unknown): void => {
    if (String(actual) !== String(wanted)) {
      differences.push(`${name}: ${String(actual)} != ${String(wanted)}`);
    }
  };
  compare("servers", entry["serversCount"], cluster.servers ?? 1);
  compare("agents", entry["agentsCount"], cluster.agents ?? 0);
  const mappings = mappingsOf(entry, inspected);
  if (mappings !== undefined) {
    for (const port of publishedPorts(cluster)) {
      const onPort = bindingsOn(mappings, port);
      if (onPort.length === 0) {
        if (port.hostPort !== undefined) {
          const under = bindingsUnder(mappings, port);
          compare(
            labelOf(port, namedFlags),
            under.length
              ? under.map((binding) => String(binding.HostPort)).join(",")
              : "unmapped",
            port.hostPort,
          );
        }
        continue;
      }
      const addresses = onPort.map(
        (binding) => addressOf(binding, port, inspected) ?? "unreported",
      );
      if (!addresses.includes(port.hostAddress)) {
        compare(
          `${labelOf(port, namedFlags)} address`,
          addresses.join(","),
          port.hostAddress,
        );
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
  ports: readonly Published[],
  namedFlags = false,
): string {
  const names = ports.map((port) => labelOf(port, namedFlags)).join(", ");
  return `k3d cluster ${clusterName} does not report the host address of ${names} in \`k3d cluster list --output json\` or \`docker inspect ${container}\`; it cannot be checked against the overlay, and recreating the cluster does not change that. Check that k3d and Docker report the load balancer's port bindings.`;
}

/** The refusal when an existing cluster differs from the overlay; it names the way back to the overlay. */
export function differsMessage(
  clusterName: string,
  differences: readonly string[],
): string {
  return `k3d cluster ${clusterName} differs from the overlay (${differences.join("; ")}); recreate it with \`kore local down --prune\` then \`kore local up\``;
}

/**
 * The refusal when, with the drift-listing-mappings flag on, neither `k3d cluster
 * list` nor docker inspect reports the load balancer's port mappings. It names the
 * gap; the cluster cannot be checked, and recreating it does not change that (#1683).
 */
export function unmappedMessage(
  clusterName: string,
  container: string,
): string {
  return `k3d cluster ${clusterName} does not report its load balancer's port mappings in \`k3d cluster list --output json\` or \`docker inspect ${container}\`; it cannot be checked against the overlay, and recreating the cluster does not change that. Check that k3d and Docker report the load balancer's port bindings.`;
}
