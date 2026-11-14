import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  HELD_LOCK_ENV,
  holdEnvironmentLock,
  holdLiveLock,
} from "../../src/runtime/index.js";

// Real host locks in a temporary host root: the live-lock behaviour the unit spec
// (src/runtime/live-lock.spec.ts) cannot see through its mocks.

afterEach(() => {
  delete process.env.KORE_HOST_ROOT;
  delete process.env.KORE_RUN_LIVE;
  delete process.env.KORE_LIVE_LOCK_WAIT_MS;
  delete process.env[HELD_LOCK_ENV];
});

async function newRoot(name: string) {
  const root = await mkdtemp(join(tmpdir(), `kore-proc-lock-${name}-`));
  process.env.KORE_HOST_ROOT = root;
  return { root, lock: join(root, ".kore", "locks", "kore-local.lock") };
}

function fakeProcess() {
  const handlers: Record<string, () => void> = {};
  return {
    handlers,
    on: (event: string, handler: () => void) =>
      void (handlers[event] = handler),
    exit: () => undefined,
  };
}

test("an opted-in test process holds the lock and releases it on exit", async () => {
  process.env.KORE_RUN_LIVE = "1";
  const { root, lock } = await newRoot("on");
  const proc = fakeProcess();
  await holdLiveLock({ scope: async () => "kore-local", process: proc });

  await expect(access(lock)).resolves.toBeUndefined();
  const owner = JSON.parse(await readFile(lock, "utf8"));
  const leasePath = join(root, ".kore", "locks", "host-lease.lock");
  const lease = JSON.parse(await readFile(leasePath, "utf8"));
  expect(process.env[HELD_LOCK_ENV]).toBe(
    `host-lease:${lease.token},kore-local:${owner.token}`,
  );
  proc.handlers.exit?.();
  await expect(access(lock)).rejects.toThrow();
  await expect(access(leasePath)).rejects.toThrow();
});

test("a live spec run waits for the host lease held by another live run", async () => {
  process.env.KORE_RUN_LIVE = "1";
  const { root, lock } = await newRoot("lease");
  const other = await holdEnvironmentLock(root, "host-lease");
  delete process.env[HELD_LOCK_ENV];
  try {
    await expect(
      holdLiveLock({
        scope: async () => "kore-local",
        process: fakeProcess(),
        waitMs: 50,
      }),
    ).rejects.toThrow(/host-lease.*waited 50 ms/);
    await expect(access(lock)).rejects.toThrow();
  } finally {
    await other.release();
  }
});

test("an interrupt releases the lock before the process dies", async () => {
  process.env.KORE_RUN_LIVE = "1";
  const { lock } = await newRoot("sigint");
  const proc = fakeProcess();
  await holdLiveLock({ scope: async () => "kore-local", process: proc });

  expect(proc.handlers.SIGINT).toBeDefined();
  expect(proc.handlers.SIGTERM).toBeDefined();
  proc.handlers.SIGINT?.();
  await expect(access(lock)).rejects.toThrow();
});

test("a test child process that inherits the holder's token takes no second lock", async () => {
  process.env.KORE_RUN_LIVE = "1";
  const { lock } = await newRoot("child");
  const parent = fakeProcess();
  await holdLiveLock({
    scope: async () => "kore-local",
    process: parent,
  });
  const before = await readFile(lock, "utf8");

  // node --test starts each spec file in a child that loads the same --import.
  const child = fakeProcess();
  await holdLiveLock({
    scope: async () => "kore-local",
    process: child,
    waitMs: 50,
  });
  expect(await readFile(lock, "utf8")).toBe(before);
  expect(child.handlers.exit).toBeUndefined();
  parent.handlers.exit?.();
});

test("a test process refuses to start while another holds the lock, naming it", async () => {
  process.env.KORE_RUN_LIVE = "1";
  const { root } = await newRoot("busy");
  const holder = await holdEnvironmentLock(root, "kore-local");
  delete process.env[HELD_LOCK_ENV];
  try {
    await expect(
      holdLiveLock({
        scope: async () => "kore-local",
        process: fakeProcess(),
        waitMs: 50,
      }),
    ).rejects.toThrow(new RegExp(`pid ${process.pid}.*waited 50 ms`));
  } finally {
    await holder.release();
  }
});
