import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "../config/index.js";
import { minikubeCluster } from "../config/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import { stopOrphanedForwards } from "./tunnel-processes.js";

export {
  isTunnelLeader,
  isTunnelSshForward,
  stopOrphanedForwards,
} from "./tunnel-processes.js";
import { type ProcessControl, type Runner } from "../runtime/index.js";

interface TunnelState {
  profile: string;
  pid: number;
}

export interface TunnelStatus {
  status: "missing" | "stale" | "running";
  pid?: number;
  port?: number;
}

export interface TunnelDependencies extends ProcessControl {
  spawnTunnel?: (profile: string) => number;
  isProcessAlive?: (pid: number) => boolean;
  isPortOpen?: (port: number) => Promise<boolean>;
  terminateProcess?: (pid: number) => void;
}

/**
 * The tunnel is spawned as a process-group leader, because `minikube tunnel`
 * starts an `ssh -L` child that holds the Gateway port; a negative pid
 * signals the whole group so no child is orphaned.
 */
function terminateGroup(pid: number, dependencies: TunnelDependencies): void {
  try {
    (
      dependencies.terminateProcess ??
      ((leader) =>
        (dependencies.signalProcess ?? process.kill.bind(process))(
          -leader,
          "SIGTERM",
        ))
    )(pid);
  } catch (error) {
    // A group that is already gone is the state the caller wanted.
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

export function tunnelStatePath(repository: Repository): string {
  return join(
    repository.root,
    ".kore",
    "state",
    `${repository.environment.name}.tunnel.json`,
  );
}

function assertLocal(repository: Repository): void {
  if (repository.environment.provider !== "minikube") {
    throw new Error(
      `kore tunnel manages a Minikube tunnel only; environment ${repository.environment.name} is a ${repository.environment.provider} overlay${repository.environment.provider === "k3d" ? ", where the k3d load balancer publishes the Gateway port and there is no tunnel process" : ""}`,
    );
  }
}

async function readState(
  repository: Repository,
): Promise<TunnelState | undefined> {
  try {
    const value = JSON.parse(
      await readFile(tunnelStatePath(repository), "utf8"),
    ) as Partial<TunnelState>;
    const pid = value.pid;
    if (
      value.profile !== minikubeCluster(repository.environment).profile ||
      typeof pid !== "number" ||
      !Number.isSafeInteger(pid) ||
      pid < 1
    ) {
      return undefined;
    }
    return { profile: value.profile, pid };
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portIsOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(300);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

function spawnTunnel(profile: string): number {
  const child = spawn(
    "minikube",
    ["tunnel", "--profile", profile, "--cleanup=false"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  if (!child.pid) {
    throw new Error("could not start the Minikube tunnel process");
  }
  return child.pid;
}

async function writeState(
  repository: Repository,
  state: TunnelState,
): Promise<void> {
  const path = tunnelStatePath(repository);
  await mkdir(join(repository.root, ".kore", "state"), { recursive: true });
  await writeFile(path, JSON.stringify(state), { mode: 0o600 });
}

export async function tunnelStatus(
  repository: Repository,
  dependencies: TunnelDependencies = {},
): Promise<TunnelStatus> {
  assertLocal(repository);
  const state = await readState(repository);
  if (!state) {
    return { status: "missing" };
  }
  if (!(dependencies.isProcessAlive ?? processIsAlive)(state.pid)) {
    return { status: "stale", pid: state.pid };
  }
  return (await (dependencies.isPortOpen ?? portIsOpen)(
    repository.environment.gateway.port,
  ))
    ? {
        status: "running",
        pid: state.pid,
        port: repository.environment.gateway.port,
      }
    : { status: "stale", pid: state.pid };
}

async function replaceStale(
  repository: Repository,
  runner: Runner,
  stalePid: number,
  dependencies: TunnelDependencies,
): Promise<void> {
  await stopLocalTunnel(repository, runner, dependencies);
  const isAlive = dependencies.isProcessAlive ?? processIsAlive;
  const deadline = Date.now() + 3_000;
  while (isAlive(stalePid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isAlive(stalePid)) {
    throw new Error(`could not stop stale Minikube tunnel process ${stalePid}`);
  }
}

export async function startLocalTunnel(
  repository: Repository,
  runner: Runner,
  dependencies: TunnelDependencies = {},
): Promise<TunnelStatus> {
  assertLocal(repository);
  await assertExpectedCluster(repository, runner);
  const current = await tunnelStatus(repository, dependencies);
  if (current.status === "running") {
    return current;
  }
  if (current.status === "stale") {
    await replaceStale(repository, runner, current.pid!, dependencies);
  } else {
    // No recorded tunnel: a crashed leader may still have left its ssh forward.
    await stopOrphanedForwards(repository, dependencies);
  }
  const pid = (dependencies.spawnTunnel ?? spawnTunnel)(
    minikubeCluster(repository.environment).profile,
  );
  const deadline = Date.now() + 15_000;
  let exitedEarly = false;
  while (Date.now() < deadline) {
    if (
      await (dependencies.isPortOpen ?? portIsOpen)(
        repository.environment.gateway.port,
      )
    ) {
      await writeState(repository, {
        profile: minikubeCluster(repository.environment).profile,
        pid,
      });
      return {
        status: "running",
        pid,
        port: repository.environment.gateway.port,
      };
    }
    if (!(dependencies.isProcessAlive ?? processIsAlive)(pid)) {
      exitedEarly = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  terminateGroup(pid, dependencies);
  throw new Error(
    `Minikube tunnel did not expose local Gateway port ${repository.environment.gateway.port}` +
      (exitedEarly
        ? `: the spawned tunnel process ${pid} exited early (minikube allows one tunnel per profile; stop any other \`minikube tunnel --profile ${minikubeCluster(repository.environment).profile}\` and retry)`
        : ""),
  );
}

export async function stopLocalTunnel(
  repository: Repository,
  _runner: Runner,
  dependencies: TunnelDependencies = {},
): Promise<void> {
  assertLocal(repository);
  const state = await readState(repository);
  if (state && (dependencies.isProcessAlive ?? processIsAlive)(state.pid)) {
    terminateGroup(state.pid, dependencies);
  }
  await stopOrphanedForwards(repository, dependencies);
  await rm(tunnelStatePath(repository), { force: true });
}

/**
 * Brings the tunnel back when it has exited or stopped answering, and leaves a
 * healthy one alone, so commands that need the Gateway endpoint can call it
 * unconditionally. A stopped profile is never restarted: the cluster check
 * inside `startLocalTunnel` fails first with the cluster-unavailable error.
 */
export async function ensureLocalTunnel(
  repository: Repository,
  runner: Runner,
  dependencies: TunnelDependencies = {},
): Promise<TunnelStatus | { status: "not-applicable" }> {
  if (repository.environment.provider !== "minikube") {
    return { status: "not-applicable" };
  }
  return await startLocalTunnel(repository, runner, dependencies);
}

export interface TunnelHealthRow {
  name: "local-tunnel";
  namespace: string;
  status: "ready" | "degraded";
  detail: string;
}

/** A read-only status row; absent for environments without a local tunnel. */
export async function tunnelHealthRow(
  repository: Repository,
  dependencies: TunnelDependencies = {},
): Promise<TunnelHealthRow | undefined> {
  if (repository.environment.provider !== "minikube") {
    return undefined;
  }
  const current = await tunnelStatus(repository, dependencies);
  const base = { name: "local-tunnel", namespace: "host" } as const;
  if (current.status === "running") {
    return {
      ...base,
      status: "ready",
      detail: `tunnel process ${current.pid} serves Gateway port ${current.port}`,
    };
  }
  const problem =
    current.status === "stale"
      ? `tunnel process ${current.pid} has exited or its Gateway port ${repository.environment.gateway.port} does not answer`
      : "no tunnel is running";
  return {
    ...base,
    status: "degraded",
    detail: `${problem}; run \`kore tunnel start --environment ${repository.environment.name}\` (\`kore platform up\` and \`kore app up\` also restart it)`,
  };
}
