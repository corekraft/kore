import { createServer } from "node:net";

/**
 * Whether a host port is free to bind on its loopback address. It binds the
 * declared address exclusively and releases it at once: the bind k3d's load
 * balancer will attempt, and no network listener, no host setting.
 */
export function bindProbe(
  hostAddress: string,
  hostPort: number,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(
        new Error(
          `cannot check host port ${hostAddress}:${hostPort}: ${error.message}. Check that ${hostAddress} is a loopback address on this host and that this user may bind port ${hostPort}, or set "optional": true on that k3d.ports entry in the overlay.`,
          { cause: error },
        ),
      );
    });
    server.listen(
      { host: hostAddress, port: hostPort, exclusive: true },
      () => {
        server.close(() => resolve(true));
      },
    );
  });
}
