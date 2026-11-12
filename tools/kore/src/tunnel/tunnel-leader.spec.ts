import { loadMinikubeLocal } from "../config/minikube-local-support.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RecordingRunner } from "../runtime/runner.js";

import {
  startLocalTunnel,
  stopLocalTunnel,
  stopOrphanedForwards,
  tunnelStatePath,
} from "./tunnel.js";

const leader =
  "/opt/homebrew/bin/minikube tunnel --profile kore-local --cleanup=false";

async function run(commands: string[]) {
  const repository = await loadMinikubeLocal();
  const signalled: number[] = [];
  const lines: string[] = [];
  await stopOrphanedForwards(repository, {
    listProcesses: async () =>
      commands.map((command, index) => ({ pid: 200 + index, command })),
    signalProcess: (pid) => void signalled.push(pid),
    report: (line) => void lines.push(line),
  });
  return { signalled, lines };
}

const probes = [
  { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
  { stdout: "kube-system", stderr: "", code: 0 },
];

function esrch(): never {
  throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
}

test("an unrecorded minikube tunnel leader for this profile is terminated and reported", async () => {
  const { signalled, lines } = await run([
    leader,
    "minikube tunnel -p kore-local",
  ]);
  expect(signalled).toEqual([200, 201]);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("200");
  expect(lines[0]).toContain("kore-local");
});

test("other profiles' tunnels and unrelated minikube commands are untouched", async () => {
  const { signalled, lines } = await run([
    "minikube tunnel --profile other --cleanup=false",
    "minikube tunnel --profile kore-local2",
    "minikube tunnel -p kore-local2",
    "minikube tunnel --profile=kore-local-x",
    "minikube status --profile kore-local",
    "minikube start -p kore-local",
    "minikube ssh --profile kore-local tunnel",
    "vim tunnel --profile kore-local",
    "/usr/bin/minikube-helper tunnel --profile kore-local",
    "minikube tunnel",
  ]);
  expect(signalled).toEqual([]);
  expect(lines).toEqual([]);
});

test("starting clears a foreign tunnel leader before spawning a new one", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-leader-"));
  const order: string[] = [];
  try {
    await startLocalTunnel(
      { ...base, root },
      new RecordingRunner([...probes]),
      {
        listProcesses: async () => [{ pid: 777, command: leader }],
        signalProcess: (pid) => void order.push(`kill ${pid}`),
        report: () => undefined,
        spawnTunnel: () => {
          order.push("spawn");
          return 9001;
        },
        isPortOpen: async () => order.includes("spawn"),
      },
    );
    expect(order).toEqual(["kill 777", "spawn"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a tunnel that exits early surfaces the actionable error even when its group is already gone", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-leader-"));
  try {
    const failure = startLocalTunnel(
      { ...base, root },
      new RecordingRunner([...probes]),
      {
        listProcesses: async () => [],
        signalProcess: esrch,
        report: () => undefined,
        spawnTunnel: () => 9001,
        isProcessAlive: () => false,
        isPortOpen: async () => false,
      },
    );
    await expect(failure).rejects.toThrow(
      /Minikube tunnel did not expose local Gateway port 8443/,
    );
    await expect(failure).rejects.toThrow(/exited/);
    await expect(failure).rejects.not.toThrow(/ESRCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stopping treats an already-gone recorded leader group as stopped", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-leader-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
  try {
    await expect(
      stopLocalTunnel(repository, new RecordingRunner(), {
        isProcessAlive: () => true,
        listProcesses: async () => [],
        signalProcess: esrch,
        report: () => undefined,
      }),
    ).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("other kill failures are still raised", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-leader-"));
  try {
    await expect(
      startLocalTunnel({ ...base, root }, new RecordingRunner([...probes]), {
        listProcesses: async () => [],
        signalProcess: () => {
          throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
        },
        report: () => undefined,
        spawnTunnel: () => 9001,
        isProcessAlive: () => false,
        isPortOpen: async () => false,
      }),
    ).rejects.toThrow(/EPERM/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
