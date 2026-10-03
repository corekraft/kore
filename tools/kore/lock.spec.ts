import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
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
