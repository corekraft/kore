import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { ensureLocalTunnel, tunnelHealthRow } from "./tunnel.js";

test("a k3d environment has no tunnel: nothing is spawned, probed or reported", async () => {
  const repository = await loadRepository("local");
  const calls: string[] = [];
  const runner: Runner = {
    async run(command) {
      calls.push(command);
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  const spawned: string[] = [];
  const dependencies = {
    spawnTunnel: () => {
      spawned.push("tunnel");
      return 1;
    },
  };
  assert.deepEqual(await ensureLocalTunnel(repository, runner, dependencies), {
    status: "not-applicable",
  });
  assert.equal(await tunnelHealthRow(repository, dependencies), undefined);
  assert.deepEqual(spawned, []);
  assert.deepEqual(calls, []);
});
