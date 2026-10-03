import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Repository } from "./config.js";
import { assertExpectedCluster } from "./cluster.js";
import type { Runner } from "./runner.js";

interface TunnelState {
  profile: string;
  pid: number;
}

export interface TunnelStatus {
  status: "missing" | "stale" | "running";
  pid?: number;
  port?: number;
}

export interface TunnelDependencies {
  spawnTunnel?: (profile: string) => number;
  isProcessAlive?: (pid: number) => boolean;
  isPortOpen?: (port: number) => Promise<boolean>;
  terminateProcess?: (pid: number) => void;
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
      "Minikube tunnel management is only available for a Minikube environment",
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
      value.profile !== repository.environment.cluster.profile ||
      typeof pid !== "number" ||
      !Number.isSafeInteger(pid) ||
      pid < 1
    )
      return undefined;
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
  if (!child.pid)
    throw new Error("could not start the Minikube tunnel process");
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
  if (!state) return { status: "missing" };
  if (!(dependencies.isProcessAlive ?? processIsAlive)(state.pid))
    return { status: "stale", pid: state.pid };
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

export async function startLocalTunnel(
  repository: Repository,
  runner: Runner,
  dependencies: TunnelDependencies = {},
): Promise<TunnelStatus> {
  assertLocal(repository);
  await assertExpectedCluster(repository, runner);
  const current = await tunnelStatus(repository, dependencies);
  if (current.status === "running") return current;
  if (current.status === "stale") {
    await stopLocalTunnel(repository, runner, dependencies);
    const isAlive = dependencies.isProcessAlive ?? processIsAlive;
    const deadline = Date.now() + 3_000;
    while (isAlive(current.pid!) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (isAlive(current.pid!))
      throw new Error(
        `could not stop stale Minikube tunnel process ${current.pid}`,
      );
  }
  const pid = (dependencies.spawnTunnel ?? spawnTunnel)(
    repository.environment.cluster.profile,
  );
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (
      await (dependencies.isPortOpen ?? portIsOpen)(
        repository.environment.gateway.port,
      )
    ) {
      await writeState(repository, {
        profile: repository.environment.cluster.profile,
        pid,
      });
      return {
        status: "running",
        pid,
        port: repository.environment.gateway.port,
      };
    }
    if (!(dependencies.isProcessAlive ?? processIsAlive)(pid)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  (
    dependencies.terminateProcess ??
    ((processId) => process.kill(processId, "SIGTERM"))
  )(pid);
  throw new Error(
    `Minikube tunnel did not expose local Gateway port ${repository.environment.gateway.port}`,
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
    (dependencies.terminateProcess ?? ((pid) => process.kill(pid, "SIGTERM")))(
      state.pid,
    );
  }
  await rm(tunnelStatePath(repository), { force: true });
}
