import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  HOST_LEASE,
  holdEnvironmentLock,
  withEnvironmentLock,
} from "../../src/runtime/index.js";

// The live run's locks, taken the way holdLiveLock takes them (the host lease,
// then the cluster lock), through the public lock API on a temporary host root.
// holdLiveLock's wiring is covered by its unit spec with mocks.

const HELD = "KORE_HELD_ENVIRONMENT_LOCK";

afterEach(() => {
  delete process.env[HELD];
});

async function newRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `kore-proc-lock-${name}-`));
}

function lockFile(root: string, name: string): string {
  return join(root, ".kore", "locks", `${name}.lock`);
}

test("an exclusive run holds the host lease and the cluster lock, and releases both on exit", async () => {
  const root = await newRoot("on");
  const lease = await holdEnvironmentLock(root, HOST_LEASE);
  const lock = await holdEnvironmentLock(root, "kore-local");

  const owner = JSON.parse(
    await readFile(lockFile(root, "kore-local"), "utf8"),
  );
  const leaseOwner = JSON.parse(
    await readFile(lockFile(root, HOST_LEASE), "utf8"),
  );
  expect(process.env[HELD]).toBe(
    `host-lease:${leaseOwner.token},kore-local:${owner.token}`,
  );
  lock.releaseSync();
  lease.releaseSync();
  await expect(access(lockFile(root, "kore-local"))).rejects.toThrow();
  await expect(access(lockFile(root, HOST_LEASE))).rejects.toThrow();
});

test("a live spec run waits for the host lease held by another live run, then is refused naming it", async () => {
  const root = await newRoot("lease");
  const other = await holdEnvironmentLock(root, HOST_LEASE);
  delete process.env[HELD];
  try {
    await expect(
      holdEnvironmentLock(root, HOST_LEASE, { waitMs: 50 }),
    ).rejects.toThrow(/host-lease.*waited 50 ms/);
    await expect(access(lockFile(root, "kore-local"))).rejects.toThrow();
  } finally {
    await other.release();
  }
});

test("an interrupt releases the cluster lock before the process dies", async () => {
  const root = await newRoot("sigint");
  const lock = await holdEnvironmentLock(root, "kore-local");

  lock.releaseSync();

  await expect(access(lockFile(root, "kore-local"))).rejects.toThrow();
});

test("a test child process that inherits the holder's token takes no second lock", async () => {
  const root = await newRoot("child");
  const parent = await holdEnvironmentLock(root, "kore-local");
  const before = await readFile(lockFile(root, "kore-local"), "utf8");

  // node --test starts each spec file in a child that inherits the holder's token.
  await withEnvironmentLock(root, "kore-local", async () => undefined);

  expect(await readFile(lockFile(root, "kore-local"), "utf8")).toBe(before);
  parent.releaseSync();
});

test("a test process refuses to start while another holds the lock, naming it", async () => {
  const root = await newRoot("busy");
  const holder = await holdEnvironmentLock(root, "kore-local");
  delete process.env[HELD];
  try {
    await expect(
      holdEnvironmentLock(root, "kore-local", { waitMs: 50 }),
    ).rejects.toThrow(new RegExp(`pid ${process.pid}.*waited 50 ms`));
  } finally {
    await holder.release();
  }
});
