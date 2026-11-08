import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import {
  startLocalTunnel,
  stopLocalTunnel,
  tunnelStatePath,
  tunnelStatus,
} from "./tunnel.js";
import { RecordingRunner } from "../runtime/runner.js";

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
