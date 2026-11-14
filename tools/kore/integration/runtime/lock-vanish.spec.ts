import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { judge } from "../../src/runtime/index.js";

const probes = { isAlive: () => true, bootTime: () => 0 };

test("a lock that vanished since the failed attempt is reported as gone, not as a legacy lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-lock-vanish-"));
  const verdict = await judge(join(root, "local.lock"), probes);

  expect(verdict).toMatchObject({ dead: false, gone: true });
});
