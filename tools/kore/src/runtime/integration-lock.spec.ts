import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { holdIntegrationLock } from "./integration-lock.js";
import { HELD_LOCK_ENV, holdEnvironmentLock } from "./lock.js";

afterEach(() => {
  delete process.env.KORE_RUN_INTEGRATION;
  delete process.env.KORE_INTEGRATION_LOCK_WAIT_MS;
  delete process.env[HELD_LOCK_ENV];
});

async function newRoot(name: string) {
  const root = await mkdtemp(join(tmpdir(), `kore-proc-lock-${name}-`));
  return { root, lock: join(root, ".kore", "locks", "local.lock") };
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

test("the test process takes no lock unless integration specs are opted into", async () => {
  const { root, lock } = await newRoot("off");
  await holdIntegrationLock({ root: async () => root });
  await expect(access(lock)).rejects.toThrow();
});

test("an opted-in test process holds the lock and releases it on exit", async () => {
  process.env.KORE_RUN_INTEGRATION = "1";
  const { root, lock } = await newRoot("on");
  const proc = fakeProcess();
  await holdIntegrationLock({ root: async () => root, process: proc });

  await expect(access(lock)).resolves.toBeUndefined();
  const owner = JSON.parse(await readFile(lock, "utf8"));
  expect(process.env[HELD_LOCK_ENV]).toBe(`local:${owner.token}`);
  proc.handlers.exit?.();
  await expect(access(lock)).rejects.toThrow();
});

test("an interrupt releases the lock before the process dies", async () => {
  process.env.KORE_RUN_INTEGRATION = "1";
  const { root, lock } = await newRoot("sigint");
  const proc = fakeProcess();
  await holdIntegrationLock({ root: async () => root, process: proc });

  expect(proc.handlers.SIGINT).toBeDefined();
  expect(proc.handlers.SIGTERM).toBeDefined();
  proc.handlers.SIGINT?.();
  await expect(access(lock)).rejects.toThrow();
});

test("a test child process that inherits the holder's token takes no second lock", async () => {
  process.env.KORE_RUN_INTEGRATION = "1";
  const { root, lock } = await newRoot("child");
  const parent = fakeProcess();
  await holdIntegrationLock({ root: async () => root, process: parent });
  const before = await readFile(lock, "utf8");

  // node --test starts each spec file in a child that loads the same --import.
  const child = fakeProcess();
  await holdIntegrationLock({
    root: async () => root,
    process: child,
    waitMs: 50,
  });
  expect(await readFile(lock, "utf8")).toBe(before);
  expect(child.handlers.exit).toBeUndefined();
  parent.handlers.exit?.();
});

test("a test process refuses to start while another holds the lock, naming it", async () => {
  process.env.KORE_RUN_INTEGRATION = "1";
  const { root } = await newRoot("busy");
  const holder = await holdEnvironmentLock(root, "local");
  delete process.env[HELD_LOCK_ENV];
  try {
    await expect(
      holdIntegrationLock({
        root: async () => root,
        process: fakeProcess(),
        waitMs: 50,
      }),
    ).rejects.toThrow(new RegExp(`pid ${process.pid}.*waited 50 ms`));
  } finally {
    await holder.release();
  }
});
