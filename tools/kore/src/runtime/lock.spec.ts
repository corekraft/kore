import {
  chmod,
  access,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test, vi } from "vitest";
import { withEnvironmentLock } from "./lock.js";

test("environment lock is removed after a successful operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-success-"));

  await expect(
    withEnvironmentLock(root, "local", async () => "done"),
  ).resolves.toBe("done");
  await expect(
    access(join(root, ".kore", "locks", "local.lock")),
  ).rejects.toThrow();
});

test("environment lock prevents concurrent mutations of the same environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-exclusive-"));
  let release!: () => void;
  let markAcquired!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const acquired = new Promise<void>((resolve) => {
    markAcquired = resolve;
  });
  const first = withEnvironmentLock(root, "local", () => {
    markAcquired();
    return blocked;
  });

  try {
    await acquired;
    await expect(
      withEnvironmentLock(root, "local", async () => undefined),
    ).rejects.toThrow(
      "another mutation is already running for environment local",
    );
    await expect(
      withEnvironmentLock(root, "managed", async () => "independent"),
    ).resolves.toBe("independent");
  } finally {
    release();
  }
  await first;
});

test("environment lock is removed when the operation throws", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-error-"));
  const lockPath = join(root, ".kore", "locks", "local.lock");

  await expect(
    withEnvironmentLock(root, "local", async () => {
      throw new Error("operation failed");
    }),
  ).rejects.toThrow("operation failed");
  await expect(access(lockPath)).rejects.toThrow();
});

async function plantLock(
  root: string,
  owner: Record<string, unknown> | string | "legacy",
): Promise<string> {
  const base = join(root, ".kore", "locks");
  const lockPath = join(base, "local.lock");
  await mkdir(base, { recursive: true });
  if (owner === "legacy") {
    await mkdir(lockPath);
  } else {
    await writeFile(
      lockPath,
      typeof owner === "string" ? owner : JSON.stringify(owner),
    );
  }
  return lockPath;
}

const deadOwner = {
  pid: 424242,
  host: hostname(),
  token: "dead-token",
  acquiredAt: new Date().toISOString(),
};

test("a lock whose owner process is alive is refused, naming the path and pid", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-live-"));
  const lockPath = await plantLock(root, deadOwner);
  let ran = false;

  const refused = withEnvironmentLock(
    root,
    "local",
    async () => {
      ran = true;
    },
    { isProcessAlive: () => true },
  );
  await expect(refused).rejects.toThrow(lockPath);
  await expect(refused).rejects.toThrow("424242");
  expect(ran).toBe(false);
  expect(JSON.parse(await readFile(lockPath, "utf8")).token).toBe("dead-token");
});

test("a lock whose owner process is dead on this host is recovered and reported", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-dead-"));
  await plantLock(root, deadOwner);
  const reports: string[] = [];

  await expect(
    withEnvironmentLock(root, "local", async () => "ran", {
      isProcessAlive: () => false,
      onRecover: (message) => reports.push(message),
    }),
  ).resolves.toBe("ran");
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatch(/424242/);
  expect(reports[0]).toMatch(/interrupted/);
  await expect(
    access(join(root, ".kore", "locks", "local.lock")),
  ).rejects.toThrow();
});

test("a lock whose pid is alive but predates the host boot is recovered", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-reboot-"));
  await plantLock(root, {
    ...deadOwner,
    acquiredAt: new Date(Date.now() - 3_600_000).toISOString(),
  });

  await expect(
    withEnvironmentLock(root, "local", async () => "ran", {
      isProcessAlive: () => true,
      bootTime: () => Date.now() - 60_000,
      onRecover: () => undefined,
    }),
  ).resolves.toBe("ran");
});

test("a lock owned by another host is never recovered", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-host-"));
  const lockPath = await plantLock(root, { ...deadOwner, host: "elsewhere" });

  const refused = withEnvironmentLock(root, "local", async () => "ran", {
    isProcessAlive: () => false,
  });
  await expect(refused).rejects.toThrow(lockPath);
  await expect(refused).rejects.toThrow("elsewhere");
  await access(lockPath);
});

test.each([
  ["a legacy directory lock", "legacy" as const],
  ["a malformed lock file", "{not json"],
  ["a lock file without a pid", JSON.stringify({ host: hostname() })],
])("%s is refused rather than broken", async (_name, owner) => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-unknown-"));
  const lockPath = await plantLock(root, owner);

  await expect(
    withEnvironmentLock(root, "local", async () => "ran", {
      isProcessAlive: () => false,
    }),
  ).rejects.toThrow(`rm -rf ${lockPath}`);
  await access(lockPath);
});

test("concurrent recovery of a dead lock yields exactly one winner", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-race-"));
  await plantLock(root, deadOwner);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let winners = 0;
  const attempt = () =>
    withEnvironmentLock(
      root,
      "local",
      async () => {
        winners += 1;
        await blocked;
      },
      {
        isProcessAlive: (pid) => pid === process.pid,
        onRecover: () => undefined,
      },
    );

  const attempts = Array.from({ length: 8 }, () => attempt());
  const settled = Promise.allSettled(attempts);
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  const results = await settled;

  expect(winners).toBe(1);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
});

test("the default liveness check refuses our own pid and recovers a pid that has exited", async () => {
  const exited = spawnSync(process.execPath, ["-e", ""]).pid;
  const live = await mkdtemp(join(tmpdir(), "kore-lock-default-live-"));
  await plantLock(live, { ...deadOwner, pid: process.pid });
  await expect(
    withEnvironmentLock(live, "local", async () => "ran"),
  ).rejects.toThrow(String(process.pid));

  const dead = await mkdtemp(join(tmpdir(), "kore-lock-default-dead-"));
  await plantLock(dead, { ...deadOwner, pid: exited });
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await expect(
      withEnvironmentLock(dead, "local", async () => "ran"),
    ).resolves.toBe("ran");
    expect(write).toHaveBeenCalledWith(expect.stringContaining("recovered"));
  } finally {
    write.mockRestore();
  }
});

test("an unreadable lock surfaces the error instead of being treated as stale", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-unreadable-"));
  const lockPath = await plantLock(root, deadOwner);
  await chmod(lockPath, 0o000);
  try {
    await expect(
      withEnvironmentLock(root, "local", async () => "ran", {
        isProcessAlive: () => false,
      }),
    ).rejects.toThrow(/EACCES/);
  } finally {
    await chmod(lockPath, 0o600);
  }
});
