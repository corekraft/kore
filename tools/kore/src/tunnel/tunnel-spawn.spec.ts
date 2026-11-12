import { loadMinikubeLocal } from "../config/minikube-local.fixtures.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";

import { startLocalTunnel, tunnelStatePath } from "./tunnel.js";
import { RecordingRunner } from "../runtime/runner.js";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

test("starts the default detached Minikube tunnel and persists its child PID", async () => {
  const base = await loadMinikubeLocal();
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
        listProcesses: async () => [],
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
  const base = await loadMinikubeLocal();
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
      startLocalTunnel(repository, runner, {
        isPortOpen: async () => true,
        listProcesses: async () => [],
      }),
      /could not start the Minikube tunnel process/,
    );
    spawnMock.mockReturnValueOnce({ pid: 8766, unref: vi.fn() });
    await assert.rejects(
      startLocalTunnel(repository, runner, {
        isPortOpen: async () => false,
        listProcesses: async () => [],
        isProcessAlive: () => false,
      }),
      /did not expose local Gateway port/,
    );
    assert.deepEqual(kill.mock.calls.at(-1), [-8766, "SIGTERM"]);
  } finally {
    spawnMock.mockReset();
    kill.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
