import { loadMinikubeLocal } from "../config/minikube-local.fixtures.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";

import { startLocalTunnel, tunnelStatePath, tunnelStatus } from "./tunnel.js";
import { RecordingRunner } from "../runtime/runner.js";

test("starts a detached Minikube tunnel for the explicit profile", async () => {
  const base = await loadMinikubeLocal();
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
    assert.deepEqual(
      await tunnelStatus(repository, {
        isProcessAlive: (pid) => pid === 4321,
        isPortOpen: async () => true,
      }),
      { status: "running", pid: 4321, port: 8443 },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replaces a stale tunnel state instead of reusing its PID", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 1234 }),
  );
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

test("terminates a tunnel process when its Gateway port never opens", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-start-failure-"));
  const repository = { ...base, root };
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  const terminated: number[] = [];
  try {
    await assert.rejects(
      startLocalTunnel(repository, runner, {
        spawnTunnel: () => 9876,
        isProcessAlive: () => false,
        isPortOpen: async () => false,
        terminateProcess: (pid) => terminated.push(pid),
      }),
      /did not expose local Gateway port 8443/,
    );
    assert.deepEqual(terminated, [9876]);
    assert.deepEqual(await tunnelStatus(repository), { status: "missing" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops a live stale process before starting its replacement", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-replace-live-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  const aliveChecks = [true, true, false];
  const terminated: number[] = [];
  try {
    const result = await startLocalTunnel(repository, runner, {
      isProcessAlive: () => aliveChecks.shift() ?? false,
      isPortOpen: async () => {
        if (terminated.length === 0) {
          return false;
        }
        return true;
      },
      terminateProcess: (pid) => terminated.push(pid),
      spawnTunnel: () => 5678,
    });
    assert.deepEqual(terminated, [4321]);
    assert.deepEqual(result, { status: "running", pid: 5678, port: 8443 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("waits for a live stale tunnel process to exit before replacement", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-wait-stale-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  const alive = [true, true, true, true, false];
  const time = vi
    .spyOn(Date, "now")
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(1);
  const timeout = vi
    .spyOn(globalThis, "setTimeout")
    .mockImplementation((callback) => {
      if (typeof callback === "function") {
        callback();
      }
      return 0 as never;
    });
  let portsChecked = 0;
  try {
    const result = await startLocalTunnel(repository, runner, {
      isProcessAlive: () => alive.shift() ?? false,
      isPortOpen: async () => portsChecked++ > 0,
      terminateProcess: () => undefined,
      spawnTunnel: () => 5678,
    });
    assert.deepEqual(result, { status: "running", pid: 5678, port: 8443 });
  } finally {
    timeout.mockRestore();
    time.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});

test("fails rather than replacing a stale tunnel whose process will not stop", async () => {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-stuck-stale-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  const time = vi
    .spyOn(Date, "now")
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(3_001);
  let spawned = false;
  try {
    await assert.rejects(
      startLocalTunnel(repository, runner, {
        isProcessAlive: () => true,
        isPortOpen: async () => false,
        terminateProcess: () => undefined,
        spawnTunnel: () => {
          spawned = true;
          return 5678;
        },
      }),
      /could not stop stale Minikube tunnel process 4321/,
    );
    assert.equal(spawned, false);
  } finally {
    time.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
