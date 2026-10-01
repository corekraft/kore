import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "./config.js";
import { startLocalTunnel, stopLocalTunnel, tunnelStatePath, tunnelStatus } from "./tunnel.js";
import { RecordingRunner } from "./runner.js";

test("starts a detached Minikube tunnel for the explicit profile", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-"));
  const repository = { ...base, root };
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  try {
    const result = await startLocalTunnel(repository, runner, {
      spawnTunnel: (profile) => {
        assert.equal(profile, "kore-local");
        return 4321;
      },
      isProcessAlive: () => true,
      isPortOpen: async () => true,
    });

    assert.deepEqual(result, { status: "running", pid: 4321, port: 8443 });
    assert.deepEqual(await tunnelStatus(repository, { isProcessAlive: (pid) => pid === 4321, isPortOpen: async () => true }), { status: "running", pid: 4321, port: 8443 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replaces a stale tunnel state instead of reusing its PID", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(tunnelStatePath(repository), JSON.stringify({ profile: "kore-local", pid: 1234 }));
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  try {
    const result = await startLocalTunnel(repository, runner, {
      spawnTunnel: () => 5678,
      isProcessAlive: () => false,
      isPortOpen: async () => true,
    });
    assert.deepEqual(result, { status: "running", pid: 5678, port: 8443 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops a managed tunnel and relies on process shutdown to clear routes", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(tunnelStatePath(repository), JSON.stringify({ profile: "kore-local", pid: 4321 }));
  const runner = new RecordingRunner();
  const terminated: number[] = [];
  try {
    await stopLocalTunnel(repository, runner, {
      isProcessAlive: (pid) => pid === 4321,
      terminateProcess: (pid) => terminated.push(pid),
    });
    assert.deepEqual(terminated, [4321]);
    assert.equal(runner.calls.length, 0);
    assert.deepEqual(await tunnelStatus(repository), { status: "missing" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not report the tunnel running when its local Gateway port is unreachable", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-health-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(tunnelStatePath(repository), JSON.stringify({ profile: "kore-local", pid: 4321 }));
  try {
    assert.deepEqual(
      await tunnelStatus(repository, { isProcessAlive: () => true, isPortOpen: async () => false }),
      { status: "stale", pid: 4321 },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
