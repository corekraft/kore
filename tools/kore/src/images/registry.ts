import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export interface RegistryDependencies {
  spawnPortForward?: (repository: Repository) => number;
  isPortOpen?: () => Promise<boolean>;
}

function spawnPortForward(repository: Repository): number {
  const child = spawn(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      "kore-registry",
      "port-forward",
      "service/oci-registry",
      "30500:5000",
    ],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
  if (!child.pid) {
    throw new Error("could not start the local OCI registry port-forward");
  }
  return child.pid;
}

/**
 * Whether the forward on `port` answers an HTTP request. A port-forward whose
 * registry pod was replaced still accepts connections until its first request,
 * then exits, so an open port alone does not prove a working forward.
 */
export async function forwardResponds(
  port: number,
  timeoutMs = 3000,
): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (answered: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(answered);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => {
      socket.write("GET /v2/ HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
    });
    socket.once("data", (chunk: Buffer) => {
      finish(chunk.toString("latin1").startsWith("HTTP/"));
    });
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });
}

async function isPortOpen(): Promise<boolean> {
  return await forwardResponds(30500);
}

async function ensurePortForward(
  repository: Repository,
  dependencies: RegistryDependencies,
): Promise<void> {
  const portReady = dependencies.isPortOpen ?? isPortOpen;
  if (await portReady()) {
    return;
  }
  (dependencies.spawnPortForward ?? spawnPortForward)(repository);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await portReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "local OCI registry port-forward did not become ready on 127.0.0.1:30500",
  );
}

export async function localRegistryReference(
  repository: Repository,
  runner: Runner,
  reference: string,
  dependencies: RegistryDependencies = {},
): Promise<string> {
  if (repository.environment.provider !== "minikube") {
    return reference;
  }
  await ensurePortForward(repository, dependencies);
  return reference.replace(/^[^/]+/, "127.0.0.1:30500");
}
