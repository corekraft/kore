import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { test, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
import { loadRepository } from "../config/index.js";
import {
  startLocalTunnel,
  stopLocalTunnel,
  tunnelStatePath,
  tunnelStatus,
} from "./tunnel.js";
import { RecordingRunner } from "../runtime/runner.js";

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
  const base = await loadRepository("local");
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

test("stops a managed tunnel and relies on process shutdown to clear routes", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
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
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
  try {
    assert.deepEqual(
      await tunnelStatus(repository, {
        isProcessAlive: () => true,
        isPortOpen: async () => false,
      }),
      { status: "stale", pid: 4321 },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("treats malformed, mismatched, and invalid tunnel state as missing", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-invalid-state-"));
  const repository = { ...base, root };
  const stateDirectory = join(root, ".kore", "state");
  await mkdir(stateDirectory, { recursive: true });
  try {
    for (const contents of [
      "not-json",
      JSON.stringify({ profile: "another-profile", pid: 4321 }),
      JSON.stringify({ profile: "kore-local", pid: 0 }),
      JSON.stringify({ profile: "kore-local", pid: 1.5 }),
    ]) {
      await writeFile(tunnelStatePath(repository), contents);
      assert.deepEqual(await tunnelStatus(repository), { status: "missing" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects tunnel operations for managed environments", async () => {
  const base = await loadRepository("local");
  const repository = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  const runner = new RecordingRunner();
  await assert.rejects(
    tunnelStatus(repository),
    /only available for a Minikube/,
  );
  await assert.rejects(
    startLocalTunnel(repository, runner),
    /only available for a Minikube/,
  );
  await assert.rejects(
    stopLocalTunnel(repository, runner),
    /only available for a Minikube/,
  );
  assert.equal(runner.calls.length, 0);
});

test("terminates a tunnel process when its Gateway port never opens", async () => {
  const base = await loadRepository("local");
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

test("removes stale tunnel state without signaling an exited process", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-stop-stale-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
  let terminated = false;
  try {
    await stopLocalTunnel(repository, new RecordingRunner(), {
      isProcessAlive: () => false,
      terminateProcess: () => (terminated = true),
    });
    assert.equal(terminated, false);
    assert.deepEqual(await tunnelStatus(repository), { status: "missing" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops a live stale process before starting its replacement", async () => {
  const base = await loadRepository("local");
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

test("checks tunnel status through the real loopback socket and process probes", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-real-probes-"));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const repository = {
    ...base,
    root,
    environment: {
      ...base.environment,
      gateway: { ...base.environment.gateway, port: address.port },
    },
  };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  try {
    await writeFile(
      tunnelStatePath(repository),
      JSON.stringify({ profile: "kore-local", pid: process.pid }),
    );
    assert.deepEqual(await tunnelStatus(repository), {
      status: "running",
      pid: process.pid,
      port: address.port,
    });

    await writeFile(
      tunnelStatePath(repository),
      JSON.stringify({ profile: "kore-local", pid: 2_147_483_647 }),
    );
    assert.deepEqual(await tunnelStatus(repository), {
      status: "stale",
      pid: 2_147_483_647,
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});

test("waits for a live stale tunnel process to exit before replacement", async () => {
  const base = await loadRepository("local");
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
  const base = await loadRepository("local");
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

test("starts the default detached Minikube tunnel and persists its child PID", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-default-spawn-"));
  const repository = { ...base, root };
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  const child = { pid: 8765, unref: vi.fn() };
  spawnMock.mockReturnValue(child);
  try {
    assert.deepEqual(
      await startLocalTunnel(repository, runner, {
        isPortOpen: async () => true,
      }),
      { status: "running", pid: 8765, port: 8443 },
    );
    assert.equal(child.unref.mock.calls.length, 1);
    assert.deepEqual(spawnMock.mock.calls.at(-1), [
      "minikube",
      ["tunnel", "--profile", "kore-local", "--cleanup=false"],
      { detached: true, stdio: "ignore" },
    ]);
    assert.deepEqual(
      JSON.parse(await readFile(tunnelStatePath(repository), "utf8")),
      {
        profile: "kore-local",
        pid: 8765,
      },
    );
  } finally {
    spawnMock.mockReset();
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a spawn failure and terminates a tunnel that exits before opening its port", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-default-failure-"));
  const repository = { ...base, root };
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  try {
    spawnMock.mockReturnValueOnce({ pid: undefined, unref: vi.fn() });
    await assert.rejects(
      startLocalTunnel(repository, runner, { isPortOpen: async () => true }),
      /could not start the Minikube tunnel process/,
    );
    spawnMock.mockReturnValueOnce({ pid: 8766, unref: vi.fn() });
    await assert.rejects(
      startLocalTunnel(repository, runner, {
        isPortOpen: async () => false,
        isProcessAlive: () => false,
      }),
      /did not expose local Gateway port/,
    );
    assert.deepEqual(kill.mock.calls.at(-1), [8766, "SIGTERM"]);
  } finally {
    spawnMock.mockReset();
    kill.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
