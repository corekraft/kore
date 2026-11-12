import { loadMinikubeLocal } from "../config/minikube-local.fixtures.js";
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

const key = "/Users/x/.minikube/machines/kore-local/id_rsa";
const ours = `/usr/bin/ssh -N -o IdentitiesOnly=yes -i ${key} docker@127.0.0.1 -p 54321 -L 8443:10.96.0.9:443 -L 15021:10.96.0.9:15021`;

async function run(commands: string[]) {
  const repository = await loadMinikubeLocal();
  const signalled: number[] = [];
  const lines: string[] = [];
  await stopOrphanedForwards(repository, {
    listProcesses: async () =>
      commands.map((command, index) => ({ pid: 100 + index, command })),
    signalProcess: (pid) => void signalled.push(pid),
    report: (line) => void lines.push(line),
  });
  return { signalled, lines };
}

test("an orphaned minikube ssh forward for this profile is terminated and reported", async () => {
  const { signalled, lines } = await run([ours]);
  expect(signalled).toEqual([100]);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("100");
});

test("ssh processes that do not match this profile's forward are untouched", async () => {
  const { signalled, lines } = await run([
    ours.replace("machines/kore-local/", "machines/other/"),
    ours.replace("machines/kore-local/", "machines/kore-local2/"),
    ours.replace("-L 8443:", "-L 9443:"),
    ours.replace("-L 15021:", "-L 15022:"),
    "/usr/bin/ssh -L 8443:h:443 -L 15021:h:15021 user@example.com",
    `vim ${key} -L 8443 -L 15021`,
  ]);
  expect(signalled).toEqual([]);
  expect(lines).toEqual([]);
});

test("forwards written attached or with a bind address still match", async () => {
  const { signalled } = await run([
    ours.replace("-L 8443:", "-L8443:"),
    ours.replace("-L 15021:", "-L 127.0.0.1:15021:"),
  ]);
  expect(signalled).toEqual([100, 101]);
});

test("no orphans is a no-op", async () => {
  expect(await run([])).toEqual({ signalled: [], lines: [] });
});

test("stop terminates the orphaned forward even when the recorded leader is already dead", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-orphan-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
  const signalled: number[] = [];
  try {
    await stopLocalTunnel(repository, new RecordingRunner(), {
      isProcessAlive: () => false,
      listProcesses: async () => [{ pid: 555, command: ours }],
      signalProcess: (pid) => void signalled.push(pid),
      report: () => undefined,
    });
    expect(signalled).toEqual([555]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("starting with no recorded tunnel clears an orphan that may hold the Gateway port", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-orphan-"));
  const repository = { ...base, root };
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  const order: string[] = [];
  try {
    await startLocalTunnel(repository, runner, {
      listProcesses: async () => [{ pid: 555, command: ours }],
      signalProcess: (pid) => void order.push(`kill ${pid}`),
      report: () => undefined,
      spawnTunnel: () => {
        order.push("spawn");
        return 9001;
      },
      isPortOpen: async () => order.includes("spawn"),
    });
    expect(order).toEqual(["kill 555", "spawn"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
