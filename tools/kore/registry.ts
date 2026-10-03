import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import type { Repository } from "./config.js";
import type { Runner } from "./runner.js";

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
  if (!child.pid)
    throw new Error("could not start the local OCI registry port-forward");
  return child.pid;
}

async function isPortOpen(): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: 30500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function ensurePortForward(
  repository: Repository,
  dependencies: RegistryDependencies,
): Promise<void> {
  const portReady = dependencies.isPortOpen ?? isPortOpen;
  if (await portReady()) return;
  (dependencies.spawnPortForward ?? spawnPortForward)(repository);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await portReady()) return;
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
  if (repository.environment.provider !== "minikube") return reference;
  await ensurePortForward(repository, dependencies);
  return reference.replace(/^[^/]+/, "127.0.0.1:30500");
}
