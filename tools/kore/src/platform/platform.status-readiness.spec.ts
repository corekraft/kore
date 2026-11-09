import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { platformStatus } from "./status.js";

const deployed = JSON.stringify({ info: { status: "deployed" } });

async function collectorRepository() {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ name }) => name === "otel-collector",
  )!;
  repository.catalog.components = [{ ...component, dependencies: [] }];
  return repository;
}

function recordingRunner(rolloutFails: boolean) {
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "helm") {
        return { stdout: deployed, stderr: "", code: 0 };
      }
      if (rolloutFails && args.includes("rollout")) {
        throw new Error("timed out waiting for the condition");
      }
      if (args.some((arg) => arg.includes("availableReplicas"))) {
        return { stdout: "available", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

test("status reports a deployed release with a crash-looping workload as degraded", async () => {
  const repository = await collectorRepository();
  const { runner } = recordingRunner(true);

  const [status] = await platformStatus(repository, runner);

  assert.equal(status?.name, "otel-collector");
  assert.equal(status?.status, "degraded");
  assert.match(status!.detail, /deployment\/otel-collector/);
  assert.match(status!.detail, /rollout/);
});

test("status reports ready once every readiness check passes", async () => {
  const repository = await collectorRepository();
  const { runner } = recordingRunner(false);

  const [status] = await platformStatus(repository, runner);

  assert.equal(status?.status, "ready");
});

test("status evaluates readiness read-only with bounded timeouts", async () => {
  const repository = await collectorRepository();
  const { runner, calls } = recordingRunner(false);

  await platformStatus(repository, runner);

  const rollout = calls.find((call) => call.includes("rollout status"));
  assert.match(rollout ?? "", /--timeout=\d+s/);
  const mutating = calls.filter((call) =>
    /\b(apply|create|delete|patch|upgrade|install|replace)\b/.test(call),
  );
  assert.deepEqual(mutating, []);
});

test("status gives each read-only check at least 15s, so a loaded host is not reported as not ready", async () => {
  const repository = await collectorRepository();
  const { runner, calls } = recordingRunner(false);

  await platformStatus(repository, runner);

  const bounds = calls
    .map((call) => /--timeout=(\d+)s/.exec(call)?.[1])
    .filter((seconds): seconds is string => seconds !== undefined)
    .map(Number);
  assert.notEqual(bounds.length, 0);
  assert.deepEqual(
    bounds.filter((seconds) => seconds < 15),
    [],
  );
});

test("a genuinely failing status check still names the object, condition and the bound it waited", async () => {
  const repository = await collectorRepository();
  const { runner } = recordingRunner(true);

  const [status] = await platformStatus(repository, runner);

  assert.match(status!.detail, /deployment\/otel-collector not ready/);
  assert.match(status!.detail, /rollout complete/);
  // The message states the bound kubectl actually waited, not the poll bound.
  assert.match(status!.detail, /within 15s/);
  assert.doesNotMatch(status!.detail, /within 3s/);
});
