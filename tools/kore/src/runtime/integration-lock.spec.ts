import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { lockEnvironmentForSpec } from "./integration-lock.js";

type Hook = () => Promise<void>;
function fakeHooks() {
  const hooks: { before?: Hook; after?: Hook } = {};
  return {
    hooks,
    register: {
      before: (fn: Hook) => void (hooks.before = fn),
      after: (fn: Hook) => void (hooks.after = fn),
    },
  };
}

afterEach(() => {
  delete process.env.KORE_RUN_INTEGRATION;
  delete process.env.KORE_ROOT;
});

test("a spec file takes no lock unless integration specs are opted into", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-spec-lock-off-"));
  const { hooks, register } = fakeHooks();
  lockEnvironmentForSpec("local", { ...register, root: async () => root });

  await hooks.before?.();
  await expect(
    access(join(root, ".kore", "locks", "local.lock")),
  ).rejects.toThrow();
  await hooks.after?.();
});

test("an opted-in spec file holds the environment lock from before to after", async () => {
  process.env.KORE_RUN_INTEGRATION = "1";
  const root = await mkdtemp(join(tmpdir(), "kore-spec-lock-on-"));
  const lockPath = join(root, ".kore", "locks", "local.lock");
  const { hooks, register } = fakeHooks();
  lockEnvironmentForSpec("local", { ...register, root: async () => root });

  await hooks.before?.();
  await expect(access(lockPath)).resolves.toBeUndefined();
  await hooks.after?.();
  await expect(access(lockPath)).rejects.toThrow();
});

test("a spec file refuses to start while another process holds the lock, naming it", async () => {
  process.env.KORE_RUN_INTEGRATION = "1";
  process.env.KORE_INTEGRATION_LOCK_WAIT_MS = "50";
  const root = await mkdtemp(join(tmpdir(), "kore-spec-lock-busy-"));
  const { holdEnvironmentLock } = await import("./lock.js");
  const holder = await holdEnvironmentLock(root, "local");
  delete process.env.KORE_HELD_ENVIRONMENT_LOCK;
  try {
    const { hooks, register } = fakeHooks();
    lockEnvironmentForSpec("local", { ...register, root: async () => root });
    await expect(hooks.before?.()).rejects.toThrow(
      new RegExp(`pid ${process.pid}.*waited 50 ms`),
    );
    await hooks.after?.();
  } finally {
    delete process.env.KORE_INTEGRATION_LOCK_WAIT_MS;
    await holder.release();
  }
});
