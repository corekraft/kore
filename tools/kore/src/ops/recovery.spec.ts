import assert from "node:assert/strict";
import { test } from "vitest";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";
import {
  loadRecovery,
  recoveryProblems,
  statefulComponents,
  type Objective,
} from "./recovery.js";

const context = {
  components: ["db", "cache", "pg-controller"],
  stateful: ["db"],
  exists: (path: string): boolean => path === "tests/db.live.spec.ts",
};

const exportObjective: Objective = {
  name: "database",
  components: ["db"],
  data: "databases",
  environment: "local",
  protection: "data-export",
  schedule: { kind: "on-demand", trigger: "before cluster destroy" },
  rpoMinutes: 1440,
  rtoMinutes: 15,
  restoreTest: "tests/db.live.spec.ts",
};

const problems = (...objectives: Objective[]): string[] =>
  recoveryProblems(objectives, context);

test("a stateful component with a tested export objective passes", () => {
  assert.deepEqual(problems(exportObjective), []);
});

test("a stateful component with no objective is reported", () => {
  assert.deepEqual(problems(), [
    "db: stateful component has no local recovery objective in infra/catalog/recovery.yaml",
  ]);
});

test("an objective for a component the catalog does not define is reported", () => {
  const found = problems({ ...exportObjective, components: ["db", "ghost"] });
  assert.deepEqual(found, ["database: unknown component ghost"]);
});

test("an export objective needs an existing live spec as its restore test", () => {
  const { restoreTest: _omit, ...rest } = exportObjective;
  assert.match(
    problems(rest).join(),
    /database: data-export needs a restoreTest/,
  );
  assert.match(
    problems({
      ...exportObjective,
      restoreTest: "tests/missing.live.spec.ts",
    }).join(),
    /database: restoreTest tests\/missing\.live\.spec\.ts does not exist/,
  );
  assert.match(
    problems({
      ...exportObjective,
      restoreTest: "tests/db.live.spec.ts.bak",
    }).join(),
    /restoreTest must be a \*\.live\.spec\.ts/,
  );
});

test("recovery time and point objectives are positive whole minutes", () => {
  const found = problems({
    ...exportObjective,
    rtoMinutes: 0,
    rpoMinutes: 1.5,
  }).join("\n");
  assert.match(found, /database: rtoMinutes must be a positive whole number/);
  assert.match(found, /database: rpoMinutes must be a positive whole number/);
});

test("a rebuild objective loses its data by design and says why", () => {
  const rebuild: Objective = {
    name: "metrics",
    components: ["db"],
    data: "metrics",
    environment: "local",
    protection: "rebuild",
    schedule: { kind: "on-demand", trigger: "kore local up recreates it" },
    rpoMinutes: null,
    rtoMinutes: 30,
    reason: "claims are labelled Delete and hold only derived telemetry",
  };
  assert.deepEqual(problems(rebuild), []);
  const { reason: _reason, ...noReason } = rebuild;
  assert.match(problems(noReason).join(), /metrics: rebuild needs a reason/);
  assert.match(
    problems({ ...rebuild, rpoMinutes: 60 }).join(),
    /metrics: rebuild recovers no data, so rpoMinutes must be null/,
  );
});

test("a cron schedule needs five fields", () => {
  assert.match(
    problems({
      ...exportObjective,
      schedule: { kind: "cron", expression: "daily" },
    }).join(),
    /database: schedule expression "daily" is not a five-field cron expression/,
  );
  assert.deepEqual(
    problems({
      ...exportObjective,
      schedule: { kind: "cron", expression: "0 2 * * *" },
    }),
    [],
  );
});

test("a managed objective that is active needs a restore test, a planned one does not", () => {
  const managed: Objective = {
    name: "managed-db",
    components: ["db"],
    data: "databases",
    environment: "managed",
    status: "planned",
    protection: "scheduled-backup",
    schedule: { kind: "cron", expression: "0 2 * * *" },
    rpoMinutes: 15,
    rtoMinutes: 60,
  };
  assert.deepEqual(problems(exportObjective, managed), []);
  assert.match(
    problems(exportObjective, { ...managed, status: "active" }).join(),
    /managed-db: an active scheduled-backup needs a restoreTest/,
  );
});

test("objective names are unique", () => {
  assert.match(
    problems(exportObjective, exportObjective).join(),
    /database: duplicate objective name/,
  );
});

test("this repository's recovery objectives cover every stateful component", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local", root);
  const stateful = await statefulComponents(root, repository);
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
  const { access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const present = new Set<string>();
  for (const objective of await loadRecovery(root)) {
    if (objective.restoreTest) {
      await access(join(root, objective.restoreTest));
      present.add(objective.restoreTest);
    }
  }
  const found = recoveryProblems(await loadRecovery(root), {
    components: repository.catalog.components.map((c) => c.name),
    stateful,
    exists: (path) => present.has(path),
  });
  assert.deepEqual(found, []);
});
