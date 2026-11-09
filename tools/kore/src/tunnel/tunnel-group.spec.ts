import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { RecordingRunner } from "../runtime/runner.js";
import {
  startLocalTunnel,
  stopLocalTunnel,
  tunnelStatePath,
} from "./tunnel.js";

// Docs: docs/decisions/0060-tunnel-recovery-on-demand.md
// `minikube tunnel` spawns an `ssh -L` child; signalling only the leader
// leaves that child holding the Gateway port. The group must be signalled.

async function withState<T>(
  run: (repository: Awaited<ReturnType<typeof loadRepository>>) => Promise<T>,
): Promise<T> {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-group-"));
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
  try {
    return await run(repository);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("stop signals the tunnel's whole process group, not only its pid", async () => {
  await withState(async (repository) => {
    const signals: [number, string][] = [];
    await stopLocalTunnel(repository, new RecordingRunner(), {
      isProcessAlive: (pid) => pid === 4321,
      signalProcess: (pid, signal) => signals.push([pid, signal]),
    });
    assert.deepEqual(signals, [[-4321, "SIGTERM"]]);
  });
});

test("stale replacement signals the old tunnel's process group before spawning", async () => {
  await withState(async (repository) => {
    const signals: [number, string][] = [];
    let alive = true;
    const events: string[] = [];
    const runner = new RecordingRunner([
      { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
      { stdout: "kube-system", stderr: "", code: 0 },
    ]);
    await startLocalTunnel(repository, runner, {
      isProcessAlive: (pid) => (pid === 4321 ? alive : true),
      isPortOpen: async () => !alive,
      signalProcess: (pid, signal) => {
        signals.push([pid, signal]);
        alive = false;
        events.push("signal");
      },
      spawnTunnel: () => {
        events.push("spawn");
        return 9999;
      },
    });
    assert.deepEqual(signals[0], [-4321, "SIGTERM"]);
    assert.ok(events.indexOf("signal") < events.indexOf("spawn"));
  });
});
