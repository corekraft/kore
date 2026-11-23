import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { loadRecovery, opsReport } from "../../src/ops/index.js";

// Real files and real units together: the recovery objectives of this
// repository, read through the ops barrel. Unit tests of recovery.ts live beside
// it in src/ops.

type Objective = Awaited<ReturnType<typeof loadRecovery>>[number];

const noProcesses: Runner = {
  run: () => Promise.reject(new Error("the recovery check starts no process")),
};

test("this repository's recovery objectives cover every stateful component", async () => {
  const root = await findRoot();
  const { report, ok } = await opsReport("recovery", {
    repository: await loadRepository("local", root),
    runner: noProcesses,
    json: false,
  });
  assert.equal(ok, true);
  assert.deepEqual(report["problems"], []);
  const stateful = report["stateful"] as string[];
  for (const name of [
    "prometheus",
    "loki",
    "grafana",
    "tempo",
    "kore-observability-config",
    "oci-registry",
    "kore-postgresql-api",
  ]) {
    assert.ok(stateful.includes(name), `${name} is detected as stateful`);
  }
});

test("this repository's recovery objectives cover every vps stateful component", async () => {
  const root = await findRoot();
  const { report, ok } = await opsReport("recovery", {
    repository: await loadRepository("vps", root),
    runner: noProcesses,
    json: false,
  });
  assert.equal(ok, true);
  assert.deepEqual(report["problems"], []);
  assert.ok((report["objectives"] as number) > 0);
});

test("the recovery schema names the vps environment", async () => {
  const schema = JSON.parse(
    await readFile(
      join(await findRoot(), "infra/catalog/schemas/recovery.schema.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    schema.properties.objectives.items.properties.environment.enum,
    ["local", "managed", "vps"],
  );
});

const vpsObjectives = async (): Promise<Objective[]> =>
  (await loadRecovery(await findRoot())).filter(
    (objective) => objective.environment === "vps",
  );

const vpsNamed = async (name: string): Promise<Objective> => {
  const found = (await vpsObjectives()).find(
    (objective) => objective.name === name,
  );
  assert.ok(found, `${name} objective is declared`);
  return found;
};

test("no objective is active without a restore test that exists", async () => {
  const active = (await loadRecovery(await findRoot())).filter(
    (objective) => objective.status === "active",
  );
  for (const objective of active) {
    assert.ok(
      objective.restoreTest,
      `${objective.name} is active without a restoreTest`,
    );
  }
});

test("the whole-box objective says it is not the no-hand promise", async () => {
  const whole = await vpsNamed("vps-whole-box");
  assert.match(whole.reason ?? "", /is not the no-hand promise/);
});

test("the registry objective names GHCR as the origin of its images", async () => {
  const registry = await vpsNamed("vps-registry");
  assert.equal(registry.protection, "rebuild");
  assert.match(registry.reason ?? "", /GHCR/);
});

test("no objective promises a shorter recovery point than its daily schedule", async () => {
  const daily = /^\S+ \S+ \* \* \*$/;
  for (const objective of await loadRecovery(await findRoot())) {
    if (
      objective.schedule.kind === "cron" &&
      daily.test(objective.schedule.expression)
    ) {
      assert.ok(
        objective.rpoMinutes === null || objective.rpoMinutes >= 1440,
        `${objective.name} promises a ${objective.rpoMinutes}-minute recovery point under a daily schedule`,
      );
    }
  }
});

test("the managed-postgresql line that contradicted its daily cron is gone", async () => {
  const names = (await loadRecovery(await findRoot())).map(
    (objective) => objective.name,
  );
  assert.ok(!names.includes("managed-postgresql"));
});
