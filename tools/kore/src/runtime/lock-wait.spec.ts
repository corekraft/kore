import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { holdEnvironmentLock, withEnvironmentLock } from "./lock.js";

const deadOwner = {
  pid: 424242,
  host: hostname(),
  token: "dead-token",
  acquiredAt: new Date().toISOString(),
};

async function plantLock(root: string, owner: string): Promise<string> {
  const base = join(root, ".kore", "locks");
  const lockPath = join(base, "local.lock");
  await mkdir(base, { recursive: true });
  await (owner === "legacy"
    ? mkdir(lockPath)
    : writeFile(lockPath, JSON.stringify(deadOwner)));
  return lockPath;
}

test("waiting for a live holder ends with a message naming the holder and the wait", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-wait-fail-"));
  const lockPath = await plantLock(root, "live");
  let ran = false;

  const refused = withEnvironmentLock(
    root,
    "local",
    async () => {
      ran = true;
    },
    { isProcessAlive: () => true, waitMs: 60, pollMs: 10 },
  );
  await expect(refused).rejects.toThrow(/waited 60 ms/);
  await expect(refused).rejects.toThrow("424242");
  await expect(refused).rejects.toThrow(lockPath);
  expect(ran).toBe(false);
  expect(JSON.parse(await readFile(lockPath, "utf8")).token).toBe("dead-token");
});

test("waiting acquires the lock once the holder releases it", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-wait-ok-"));
  const lockPath = await plantLock(root, "live");
  setTimeout(() => void rm(lockPath, { force: true }), 40);

  await expect(
    withEnvironmentLock(root, "local", async () => "ran", {
      isProcessAlive: () => true,
      waitMs: 2_000,
      pollMs: 10,
    }),
  ).resolves.toBe("ran");
});

test("a lock that cannot be proven dead and is not held by a live process fails without waiting", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-nowait-"));
  await plantLock(root, "legacy");
  const started = Date.now();

  await expect(
    withEnvironmentLock(root, "local", async () => "ran", {
      waitMs: 5_000,
      pollMs: 10,
    }),
  ).rejects.toThrow(/legacy or malformed/);
  expect(Date.now() - started).toBeLessThan(2_000);
});

test("a held lock is released when the holder's work failed", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-hold-"));
  const lockPath = join(root, ".kore", "locks", "local.lock");
  const held = await holdEnvironmentLock(root, "local");
  await expect(access(lockPath)).resolves.toBeUndefined();

  try {
    throw new Error("spec failed");
  } catch {
    // the spec failed; its finally still releases
  } finally {
    await held.release();
  }
  await expect(access(lockPath)).rejects.toThrow();
  await held.release();
});

test("a kore call nested in a held lock runs instead of deadlocking, and leaves the lock held", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-nested-"));
  const lockPath = join(root, ".kore", "locks", "local.lock");
  const held = await holdEnvironmentLock(root, "local");
  try {
    await expect(
      withEnvironmentLock(root, "local", async () => "nested ran", {
        waitMs: 0,
      }),
    ).resolves.toBe("nested ran");
    await expect(access(lockPath)).resolves.toBeUndefined();
    // Another environment is not covered by the holder's token.
    await expect(
      withEnvironmentLock(root, "managed", async () => "independent"),
    ).resolves.toBe("independent");
  } finally {
    await held.release();
  }
  await expect(access(lockPath)).rejects.toThrow();
});

test("a nested call does not inherit the lock once the holder released it", async () => {
  // A live run exports its held token to child processes; start from none.
  const token = (): string | undefined =>
    process.env.KORE_HELD_ENVIRONMENT_LOCK;
  const ambient = token();
  delete process.env.KORE_HELD_ENVIRONMENT_LOCK;
  const root = await mkdtemp(join(tmpdir(), "kore-lock-stale-token-"));
  const held = await holdEnvironmentLock(root, "local");
  const inherited = token();
  await held.release();
  expect(process.env.KORE_HELD_ENVIRONMENT_LOCK).toBeUndefined();

  process.env.KORE_HELD_ENVIRONMENT_LOCK = inherited as string;
  try {
    // A stale token with no matching lock file must take the lock normally.
    await expect(
      withEnvironmentLock(root, "local", async () => {
        const owner = JSON.parse(
          await readFile(join(root, ".kore", "locks", "local.lock"), "utf8"),
        );
        return owner.pid;
      }),
    ).resolves.toBe(process.pid);
  } finally {
    if (ambient === undefined) {
      delete process.env.KORE_HELD_ENVIRONMENT_LOCK;
    } else {
      process.env.KORE_HELD_ENVIRONMENT_LOCK = ambient;
    }
  }
});

test("the holder exports its lock token so child kore processes nest instead of blocking", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-child-"));
  // Pin the environment: a lock the surrounding run already holds (a host
  // lease, the nightly's cluster) is inherited and would be listed too.
  const inherited = process.env.KORE_HELD_ENVIRONMENT_LOCK;
  delete process.env.KORE_HELD_ENVIRONMENT_LOCK;
  let held: Awaited<ReturnType<typeof holdEnvironmentLock>> | undefined;
  try {
    held = await holdEnvironmentLock(root, "local");
    const exported = process.env.KORE_HELD_ENVIRONMENT_LOCK ?? "";
    const owner = JSON.parse(
      await readFile(join(root, ".kore", "locks", "local.lock"), "utf8"),
    );
    expect(exported).toBe(`local:${owner.token}`);
  } finally {
    await held?.release();
    if (inherited === undefined) {
      delete process.env.KORE_HELD_ENVIRONMENT_LOCK;
    } else {
      process.env.KORE_HELD_ENVIRONMENT_LOCK = inherited;
    }
  }
});

test("a wait that starts says once who it waits for, where, and for how long", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-wait-notice-"));
  const lockPath = await plantLock(root, "live");
  const owner = { ...deadOwner, cwd: "/work/other-worktree" };
  await writeFile(lockPath, JSON.stringify(owner));
  setTimeout(() => void rm(lockPath, { force: true }), 80);
  const notices: string[] = [];

  await withEnvironmentLock(root, "local", async () => "ran", {
    isProcessAlive: () => true,
    waitMs: 2_000,
    pollMs: 10,
    onWait: (message) => notices.push(message),
  });

  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("424242");
  expect(notices[0]).toContain("/work/other-worktree");
  expect(notices[0]).toContain(lockPath);
  expect(notices[0]).toContain("2000 ms");
});

test("a lock taken at once prints no wait notice", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-nonotice-"));
  const notices: string[] = [];

  await withEnvironmentLock(root, "local", async () => "ran", {
    waitMs: 2_000,
    onWait: (message) => notices.push(message),
  });

  expect(notices).toEqual([]);
});

test("a holder that records no worktree is still named by its pid", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-notice-legacy-"));
  const lockPath = await plantLock(root, "live");
  setTimeout(() => void rm(lockPath, { force: true }), 40);
  const notices: string[] = [];

  await withEnvironmentLock(root, "local", async () => "ran", {
    isProcessAlive: () => true,
    waitMs: 2_000,
    pollMs: 10,
    onWait: (message) => notices.push(message),
  });

  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain("424242");
});

test("a lock records the worktree that holds it", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-cwd-"));
  const lockPath = join(root, ".kore", "locks", "local.lock");

  await withEnvironmentLock(root, "local", async () => {
    expect(JSON.parse(await readFile(lockPath, "utf8")).cwd).toBe(
      process.cwd(),
    );
  });
});
