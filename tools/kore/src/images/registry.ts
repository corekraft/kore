import { spawn } from "node:child_process";
import { connect } from "node:tls";
import type { Repository } from "../config/index.js";
import {
  listHostProcesses,
  terminateMatching,
  type ProcessControl,
  type Runner,
} from "../runtime/index.js";
import {
  clearForwardOwner,
  ownershipConflict,
  readForwardOwner,
  recordForwardOwner,
} from "./registry-forward-owner.js";
import { loadRegistryCa } from "./registry-tls.js";

export interface RegistryDependencies {
  spawnPortForward?: (repository: Repository) => number;
  isPortOpen?: (ca: string) => Promise<boolean>;
  /** Receives a warning line. Defaults to stderr. */
  report?: (line: string) => void;
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
 * Whether the forward on `port` answers an HTTPS request. A port-forward whose
 * registry pod was replaced still accepts connections until its first request,
 * then exits, so an open port alone does not prove a working forward. The
 * handshake verifies the registry's certificate against `ca` (ADR 0058), so a
 * forward to anything but the kore registry is never ready.
 */
export async function forwardResponds(
  port: number,
  ca: string,
  timeoutMs = 3000,
): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = connect({
      host: "127.0.0.1",
      port,
      ca,
      rejectUnauthorized: true,
    });
    const finish = (answered: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(answered);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("secureConnect", () => {
      socket.write("GET /v2/ HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
    });
    socket.once("data", (chunk: Buffer) => {
      finish(chunk.toString("latin1").startsWith("HTTP/"));
    });
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });
}

async function isPortOpen(ca: string): Promise<boolean> {
  return await forwardResponds(30500, ca);
}

/** A forward found open with no recorded owner could be stopped by any worktree; say so. */
async function reportUnownedForward(
  repository: Repository,
  dependencies: RegistryDependencies,
): Promise<void> {
  const context = repository.environment.kubeContext;
  if ((await readForwardOwner(context)) !== undefined) {
    return;
  }
  (dependencies.report ?? ((line) => void process.stderr.write(`${line}\n`)))(
    `registry port-forward on 127.0.0.1:30500 for context ${context} is already running with no owner recorded, so this run uses it but does not own it; any worktree's stop can end it mid-build`,
  );
}

async function ensurePortForward(
  repository: Repository,
  dependencies: RegistryDependencies,
  ca: string,
): Promise<void> {
  const portReady = dependencies.isPortOpen ?? isPortOpen;
  if (await portReady(ca)) {
    await reportUnownedForward(repository, dependencies);
    return;
  }
  const pid = (dependencies.spawnPortForward ?? spawnPortForward)(repository);
  await recordForwardOwner(repository, pid);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await portReady(ca)) {
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
  if (repository.environment.provider !== "k3d") {
    return reference;
  }
  await ensurePortForward(
    repository,
    dependencies,
    await loadRegistryCa(repository, runner),
  );
  return reference.replace(/^[^/]+/, "127.0.0.1:30500");
}

/**
 * Terminates the registry port-forward `ensurePortForward` leaves running,
 * matched by its full command line for this environment's kube context. A
 * forward for another context, or any other kubectl, is untouched; with none
 * running this does nothing. A forward another worktree started, and that
 * worktree still exists, or by another kore process still running in this
 * worktree, is left running: one stop must not cut the registry from a build
 * that is using it. `force` stops it anyway.
 */
export async function stopRegistryForward(
  repository: Repository,
  control: ProcessControl = {},
  options: { force?: boolean } = {},
): Promise<number[]> {
  const context = repository.environment.kubeContext;
  const owner = await readForwardOwner(context);
  const conflict =
    options.force === true
      ? undefined
      : ownershipConflict(owner, repository.root);
  if (owner !== undefined && conflict !== undefined) {
    const running = await (control.listProcesses ?? listHostProcesses)();
    if (running.some((entry) => entry.pid === owner.pid)) {
      (control.report ?? ((line) => void process.stderr.write(`${line}\n`)))(
        `left registry port-forward ${owner.pid} for context ${context} running: ${conflict}; or pass --force to stop it anyway`,
      );
      return [];
    }
  }
  const stopped = await terminateMatching(
    ({ command }) => {
      const argv = command.trim().split(/\s+/);
      return (
        /(?:^|\/)kubectl$/.test(argv[0] ?? "") &&
        argv.slice(1).join(" ") ===
          `--context ${context} --namespace kore-registry port-forward service/oci-registry 30500:5000`
      );
    },
    (entry) =>
      `stopped registry port-forward ${entry.pid} for context ${context}`,
    control,
  );
  await clearForwardOwner(context);
  return stopped;
}
