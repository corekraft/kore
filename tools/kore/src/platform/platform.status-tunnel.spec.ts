import assert from "node:assert/strict";
import { test, vi } from "vitest";

vi.mock("./status.js", () => ({ platformStatus: vi.fn(async () => []) }));
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { platformStatusReport } from "./crd-ownership-status.js";

// Docs: docs/decisions/0060-tunnel-recovery-on-demand.md
// Status never restarts the tunnel; it reports the dead one with the remedy.

test("platform status reports a dead local tunnel as degraded with the remedy, read-only", async () => {
  const repository = await loadRepository("local");
  const calls: string[] = [];
  const runner: Runner = {
    async run(command) {
      calls.push(command);
      return { stdout: '{"items":[]}', stderr: "", code: 0 };
    },
  };

  const rows = await platformStatusReport(repository, runner, undefined, {
    isProcessAlive: () => false,
    isPortOpen: async () => false,
    spawnTunnel: () => assert.fail("status must not start a tunnel"),
  });

  const row = rows.find((candidate) => candidate.name === "local-tunnel");
  assert.equal(row?.status, "degraded");
  assert.match(row?.detail ?? "", /kore tunnel start --environment local/);
  assert.ok(!calls.includes("minikube"));
});
