import type { K3dCluster } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { bindProbe, type HostProtocol } from "./k3d-port-probe.js";

type K3dPort = K3dCluster["ports"][number];

/** Whether a host port is free to bind on its address, over its transport. */
export type PortProbe = (
  hostAddress: string,
  hostPort: number,
  protocol: HostProtocol,
) => Promise<boolean>;

/**
 * The process listening on a host port, as lsof names it (`command (pid n)`);
 * undefined when lsof names none or is not installed. Read-only. A UDP port
 * has no LISTEN state, so its lookup is every UDP socket on the port.
 */
async function holderOf(
  runner: Runner,
  hostPort: number,
  protocol: HostProtocol,
): Promise<string | undefined> {
  const args =
    protocol === "udp"
      ? ["-nP", `-iUDP:${hostPort}`, "-Fpc"]
      : ["-nP", `-iTCP:${hostPort}`, "-sTCP:LISTEN", "-Fpc"];
  let stdout: string;
  try {
    ({ stdout } = await runner.run("lsof", args, { capture: true }));
  } catch (error) {
    if (
      error instanceof CommandError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
  const pid = /^p(\d+)$/m.exec(stdout)?.[1];
  if (pid === undefined) {
    return undefined;
  }
  const command = /^c(.*)$/m.exec(stdout)?.[1] ?? "unknown command";
  return `${command} (pid ${pid})`;
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

/**
 * Refuses a cluster that is about to be created when a declared host port is
 * taken on its loopback address, over the mapping's own transport. Every taken
 * port is named. Optional ports are skipped. Runs no cluster command; the
 * caller runs it before create.
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
