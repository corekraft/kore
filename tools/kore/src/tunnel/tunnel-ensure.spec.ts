import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { ClusterUnavailableError } from "../cluster/index.js";
import { loadRepository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import {
  ensureLocalTunnel,
  tunnelHealthRow,
  tunnelStatePath,
  type TunnelDependencies,
} from "./tunnel.js";

const healthy = {
  async run(command) {
    return {
      stdout: command === "minikube" ? '{"Host":"Running"}' : "kube-system",
      stderr: "",
      code: 0,
    };
  },
} satisfies Runner;

const stoppedProfile: Runner = {
  async run(command, args) {
    if (command === "minikube") {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "profile not found",
        code: 85,
      });
    }
    return { stdout: "kube-system", stderr: "", code: 0 };
  },
};

async function fixture(pid?: number) {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-tunnel-ensure-"));
  const repository = { ...base, root };
  if (pid !== undefined) {
    await mkdir(join(root, ".kore", "state"), { recursive: true });
    await writeFile(
      tunnelStatePath(repository),
      JSON.stringify({ profile: "kore-local", pid }),
    );
  }
  return { repository, root };
}

/** A fake host: tracks live pids, spawns and terminations. */
function host(alive: number[]) {
  const live = new Set(alive);
  const spawned: number[] = [];
  const terminated: number[] = [];
  let next = 5000;
  const dependencies: TunnelDependencies = {
    spawnTunnel: () => {
      next += 1;
      live.add(next);
      spawned.push(next);
      return next;
    },
    isProcessAlive: (pid) => live.has(pid),
    isPortOpen: async () => [...live].some((pid) => pid >= 5000),
    terminateProcess: (pid) => {
      terminated.push(pid);
      live.delete(pid);
    },
  };
  return { dependencies, live, spawned, terminated };
}

test("restarts an exited tunnel once and does not start a duplicate on the next call", async () => {
  const { repository, root } = await fixture(1234);
  const fake = host([]); // pid 1234 has exited
  try {
    const first = await ensureLocalTunnel(
      repository,
      healthy,
      fake.dependencies,
    );
    assert.deepEqual(first, { status: "running", pid: 5001, port: 8443 });
    const second = await ensureLocalTunnel(
      repository,
      healthy,
      fake.dependencies,
    );
    assert.deepEqual(second, first);
    assert.deepEqual(fake.spawned, [5001]);
    assert.deepEqual(fake.terminated, []); // an exited pid is never signalled
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("starts a tunnel when no state file exists", async () => {
  const { repository, root } = await fixture();
  const fake = host([]);
  try {
    await ensureLocalTunnel(repository, healthy, fake.dependencies);
    assert.deepEqual(fake.spawned, [5001]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replaces a live tunnel whose Gateway port stopped answering without leaving two processes", async () => {
  const { repository, root } = await fixture(1234);
  const fake = host([1234]);
  let portOpen = false;
  const dependencies: TunnelDependencies = {
    ...fake.dependencies,
    isPortOpen: async () => portOpen || fake.spawned.length > 0,
  };
  try {
    await ensureLocalTunnel(repository, healthy, dependencies);
    assert.deepEqual(fake.terminated, [1234]);
    assert.deepEqual(fake.spawned, [5001]);
    assert.deepEqual([...fake.live], [5001]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("leaves a healthy tunnel alone", async () => {
  const { repository, root } = await fixture(1234);
  const fake = host([1234]);
  try {
    const result = await ensureLocalTunnel(repository, healthy, {
      ...fake.dependencies,
      isPortOpen: async () => true,
    });
    assert.deepEqual(result, { status: "running", pid: 1234, port: 8443 });
    assert.deepEqual(fake.spawned, []);
    assert.deepEqual(fake.terminated, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not restart the tunnel when the profile is stopped", async () => {
  const { repository, root } = await fixture(1234);
  const fake = host([]);
  try {
    await assert.rejects(
      ensureLocalTunnel(repository, stoppedProfile, fake.dependencies),
      ClusterUnavailableError,
    );
    assert.deepEqual(fake.spawned, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does nothing for a managed environment", async () => {
  const { repository, root } = await fixture();
  const managed = {
    ...repository,
    environment: { ...repository.environment, provider: "gke" },
  } as unknown as typeof repository;
  const fake = host([]);
  try {
    assert.deepEqual(
      await ensureLocalTunnel(managed, healthy, fake.dependencies),
      { status: "not-applicable" },
    );
    assert.deepEqual(fake.spawned, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports an exited tunnel as degraded with the remedy, and a running one as ready", async () => {
  const { repository, root } = await fixture(1234);
  try {
    const dead = await tunnelHealthRow(repository, {
      isProcessAlive: () => false,
      isPortOpen: async () => false,
    });
    assert.equal(dead?.status, "degraded");
    assert.match(dead?.detail ?? "", /kore tunnel start --environment local/);
    const alive = await tunnelHealthRow(repository, {
      isProcessAlive: () => true,
      isPortOpen: async () => true,
    });
    assert.equal(alive?.status, "ready");
    await rm(tunnelStatePath(repository));
    const missing = await tunnelHealthRow(repository);
    assert.equal(missing?.status, "degraded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports no tunnel row for a managed environment", async () => {
  const { repository, root } = await fixture();
  const managed = {
    ...repository,
    environment: { ...repository.environment, provider: "gke" },
  } as unknown as typeof repository;
  try {
    assert.equal(await tunnelHealthRow(managed), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
