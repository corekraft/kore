import { loadMinikubeLocal } from "../config/minikube-local.fixtures.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { test } from "vitest";

import { tunnelStatePath, tunnelStatus } from "./tunnel.js";

test("does not report the tunnel running when its local Gateway port is unreachable", async () => {
  const base = await loadMinikubeLocal();
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
  const base = await loadMinikubeLocal();
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

test("checks tunnel status through the real loopback socket and process probes", async () => {
  const base = await loadMinikubeLocal();
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
