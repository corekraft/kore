import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { holdEnvironmentLock } from "../../src/runtime/index.js";

// A lock that vanishes while a run waits for it is taken, not refused as a
// legacy or malformed lock. The judge's "gone" verdict itself is a unit of
// lock-recovery.ts and is covered by its unit spec with mocks.

test("a live holder whose lock vanishes during the wait is taken, not refused as legacy", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-vanish-"));
  const locks = join(root, ".kore", "locks");
  const lockPath = join(locks, "local.lock");
  await mkdir(locks, { recursive: true });
  await writeFile(
    lockPath,
    JSON.stringify({
      pid: process.pid,
      host: hostname(),
      token: "live-token",
      acquiredAt: new Date().toISOString(),
    }),
  );
  setTimeout(() => void rm(lockPath, { force: true }), 40);

  const held = await holdEnvironmentLock(root, "local", {
    isProcessAlive: () => true,
    waitMs: 2_000,
    pollMs: 10,
    onWait: () => undefined,
  });

  expect(held).toBeDefined();
  held.releaseSync();
});
