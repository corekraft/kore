import {
  featureEnabled,
  type Environment,
  type K3dCluster,
} from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { bindProbe, type HostProtocol } from "./k3d-port-probe.js";

type K3dPort = K3dCluster["ports"][number];

/**
 * The overlay's ports that are published now: a port naming a feature flag
 * counts only while the flag is on, and a port the environment opts out of
 * never counts, for the create arguments, the drift check and the host port
 * check alike (an unset flag means always).
 */
export function activePorts(
  environment: Pick<Environment, "features" | "k3d">,
): K3dPort[] {
  return (environment.k3d?.ports ?? []).filter(
    ({ featureFlag, optOut }) =>
      optOut !== true &&
      (featureFlag === undefined || featureEnabled(environment, featureFlag)),
  );
}

/** Whether a host port is free to bind on its address, over its transport. */
export type PortProbe = (
  hostAddress: string,
  hostPort: number,
  protocol: HostProtocol,
) => Promise<boolean>;

/**
 * What lsof says about a host port: the process listening on it (as lsof names
 * it, `command (pid n)`), nothing, or that lsof could not run at all.
 */
export type Listener =
  { kind: "held"; holder: string } | { kind: "free" } | { kind: "unavailable" };

/**
 * The listener on a host port, read-only. lsof exits 1 when it names none, so
 * that is free; a missing lsof is unavailable, which is not the same answer. A
 * UDP port has no LISTEN state, so its lookup is every UDP socket on the port.
 */
async function listenerOf(
  runner: Runner,
  hostPort: number,
  protocol: HostProtocol,
): Promise<Listener> {
  const args =
    protocol === "udp"
      ? ["-nP", `-iUDP:${hostPort}`, "-Fpc"]
      : ["-nP", `-iTCP:${hostPort}`, "-sTCP:LISTEN", "-Fpc"];
  let stdout: string;
  try {
    ({ stdout } = await runner.run("lsof", args, { capture: true }));
  } catch (error) {
    if (error instanceof CommandError) {
      return { kind: "free" };
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "unavailable" };
    }
    throw error;
  }
  const pid = /^p(\d+)$/m.exec(stdout)?.[1];
  if (pid === undefined) {
    return { kind: "free" };
  }
  const command = /^c(.*)$/m.exec(stdout)?.[1] ?? "unknown command";
  return { kind: "held", holder: `${command} (pid ${pid})` };
}

/** The holder of a host port when lsof names one; undefined when it names none or cannot run. */
async function holderOf(
  runner: Runner,
  hostPort: number,
  protocol: HostProtocol,
): Promise<string | undefined> {
  const listener = await listenerOf(runner, hostPort, protocol);
  return listener.kind === "held" ? listener.holder : undefined;
}

/**
 * The refusal for a privileged host port (below 1024), which kore never binds
 * to check: it names the port as privileged, then the holder, or that lsof was
 * unavailable so the port cannot be checked at all.
 */
function privilegedRefusal(
  environmentName: string,
  port: K3dPort,
  index: number,
  protocol: HostProtocol,
  listener: Exclude<Listener, { kind: "free" }>,
): string {
  const named = `${port.hostAddress}:${port.hostPort}${protocol === "udp" ? "/udp" : ""}`;
  const setting = `The overlay setting that publishes it is k3d.ports[${index}] (loadBalancerPort ${port.loadBalancerPort}) in environment ${environmentName}.`;
  if (listener.kind === "held") {
    return `host port ${named} is privileged (below 1024) and already in use, so the cluster cannot publish it. ${setting} Holder: ${listener.holder}. Free the port by stopping the process holding it, or change k3d.ports[${index}].hostPort, then rerun kore local up --environment ${environmentName}.`;
  }
  return `host port ${named} is privileged (below 1024), so kore cannot bind it to check, and lsof was unavailable to name a holder, so the cluster cannot be checked. ${setting} Install lsof, or set "optional": true on k3d.ports[${index}] to skip this port, then rerun kore local up --environment ${environmentName}.`;
}

/** One taken port's refusal: the port, the overlay setting that publishes it, and the holder when known. */
function refusal(
  environmentName: string,
  port: K3dPort,
  index: number,
  protocol: HostProtocol,
  holder: string | undefined,
): string {
  const who =
    holder === undefined
      ? "The holder could not be identified: lsof reported none or is not installed."
      : `Holder: ${holder}.`;
  const named = `${port.hostAddress}:${port.hostPort}${protocol === "udp" ? "/udp" : ""}`;
  return `host port ${named} is already in use, so the cluster cannot publish it. The overlay setting that publishes it is k3d.ports[${index}] (loadBalancerPort ${port.loadBalancerPort}) in environment ${environmentName}. ${who} Free the port by stopping the process holding it, or change k3d.ports[${index}].hostPort, then rerun kore local up --environment ${environmentName}.`;
}

/** The highest privileged host port: below it only root may bind, so this user's probe cannot tell a free one (ADR 0132). */
const privilegedPortLimit = 1024;

/**
 * Refuses a cluster that is about to be created when a declared host port is
 * taken on its loopback address, over the mapping's own transport. Every taken
 * port is named. Optional ports are skipped. Runs no cluster command; the
 * caller runs it before create.
 *
 * A privileged port (below 1024, such as the 443 entry point) is not probed:
 * this user's bind fails there whether or not anything holds it, so the
 * listener lookup decides alone, and no listener means the port is free for
 * Docker, which runs the mapping as root.
 */
export async function checkHostPorts(
  environmentName: string,
  cluster: K3dCluster,
  runner: Runner,
  probe?: PortProbe,
): Promise<void> {
  const isFree = probe ?? bindProbe;
  const refusals: string[] = [];
  for (const [index, port] of cluster.ports.entries()) {
    if (port.optional === true) {
      continue;
    }
    const protocol: HostProtocol = port.protocol ?? "tcp";
    if (port.hostPort < privilegedPortLimit) {
      const listener = await listenerOf(runner, port.hostPort, protocol);
      if (listener.kind !== "free") {
        refusals.push(
          privilegedRefusal(environmentName, port, index, protocol, listener),
        );
      }
      continue;
    }
    if (await isFree(port.hostAddress, port.hostPort, protocol)) {
      continue;
    }
    refusals.push(
      refusal(
        environmentName,
        port,
        index,
        protocol,
        await holderOf(runner, port.hostPort, protocol),
      ),
    );
  }
  if (refusals.length > 0) {
    throw new Error(refusals.join("\n"));
  }
}
