import { createSocket } from "node:dgram";
import { createServer } from "node:net";

/** The transport a host port is published on; TCP unless the overlay says UDP. */
export type HostProtocol = "tcp" | "udp";

/** Binds a TCP port on the address and releases it at once; rejects with the bind error. */
function bindTcp(hostAddress: string, hostPort: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(
      { host: hostAddress, port: hostPort, exclusive: true },
      () => {
        server.close(() => resolve());
      },
    );
  });
}

/** Binds a UDP port on the address and releases it at once; rejects with the bind error. */
function bindUdp(hostAddress: string, hostPort: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    socket.once("error", (error) => {
      socket.close();
      reject(error);
    });
    socket.bind(
      { address: hostAddress, port: hostPort, exclusive: true },
      () => {
        socket.close(() => resolve());
      },
    );
  });
}

const addressInUse = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "EADDRINUSE";

/**
 * Whether a host port is free to bind on its loopback address, over the
 * mapping's own transport. It binds the declared address exclusively and
 * releases it at once: the bind k3d's load balancer will attempt, and no
 * network listener, no host setting.
 */
export async function bindProbe(
  hostAddress: string,
  hostPort: number,
  protocol: HostProtocol = "tcp",
): Promise<boolean> {
  const endpoint = `${hostAddress}:${hostPort}${protocol === "udp" ? "/udp" : ""}`;
  try {
    await (protocol === "udp" ? bindUdp : bindTcp)(hostAddress, hostPort);
    return true;
  } catch (error) {
    if (addressInUse(error)) {
      return false;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cannot check host port ${endpoint}: ${reason}. Check that ${hostAddress} is a loopback address on this host and that this user may bind port ${hostPort}${protocol === "udp" ? "/udp" : ""}, or set "optional": true on that k3d.ports entry in the overlay.`,
      { cause: error },
    );
  }
}
