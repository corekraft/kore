import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { exists } from "../config/index.js";
import {
  checkRecovery,
  loadRecovery,
  recoveryProblems,
  statefulComponents,
  type Objective,
} from "./recovery.js";
import { fakeRepository, serveDirectories, serveFiles } from "./ops-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("../config/index.js");

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

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

test("a stateful component with a tested export objective passes", () => {
  expect(problems(exportObjective)).toEqual([]);
});

test("a stateful component with no objective is reported", () => {
  expect(problems()).toEqual([
    "db: stateful component has no local recovery objective in infra/catalog/recovery.yaml",
  ]);
});

test("an objective for a component the catalog does not define is reported", () => {
  expect(problems({ ...exportObjective, components: ["db", "ghost"] })).toEqual(
    ["database: unknown component ghost"],
  );
});

test("an export objective needs an existing live spec as its restore test", () => {
  const { restoreTest: _omit, ...rest } = exportObjective;
  expect(problems(rest).join()).toMatch(
    /database: data-export needs a restoreTest/,
  );
  expect(
    problems({
      ...exportObjective,
      restoreTest: "tests/missing.live.spec.ts",
    }).join(),
  ).toMatch(
    /database: restoreTest tests\/missing\.live\.spec\.ts does not exist/,
  );
  expect(
    problems({
      ...exportObjective,
      restoreTest: "tests/db.live.spec.ts.bak",
    }).join(),
  ).toMatch(/restoreTest must be a \*\.live\.spec\.ts/);
});

test("recovery time and point objectives are positive whole minutes", () => {
  const found = problems({
    ...exportObjective,
    rtoMinutes: 0,
    rpoMinutes: 1.5,
  }).join("\n");
  expect(found).toMatch(/database: rtoMinutes must be a positive whole number/);
  expect(found).toMatch(/database: rpoMinutes must be a positive whole number/);
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
  expect(problems(rebuild)).toEqual([]);
  const { reason: _reason, ...noReason } = rebuild;
  expect(problems(noReason).join()).toMatch(/metrics: rebuild needs a reason/);
  expect(problems({ ...rebuild, rpoMinutes: 60 }).join()).toMatch(
    /metrics: rebuild recovers no data, so rpoMinutes must be null/,
  );
});

test("a cron schedule needs five fields", () => {
  expect(
    problems({
      ...exportObjective,
      schedule: { kind: "cron", expression: "daily" },
    }).join(),
  ).toMatch(
    /database: schedule expression "daily" is not a five-field cron expression/,
  );
  expect(
    problems({
      ...exportObjective,
      schedule: { kind: "cron", expression: "0 2 * * *" },
    }),
  ).toEqual([]);
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
  expect(problems(exportObjective, managed)).toEqual([]);
  expect(
    problems(exportObjective, { ...managed, status: "active" }).join(),
  ).toMatch(/managed-db: an active scheduled-backup needs a restoreTest/);
});

test("objective names are unique", () => {
  expect(problems(exportObjective, exportObjective).join()).toMatch(
    /database: duplicate objective name/,
  );
});

test("the recovery objectives file is read under the repository root", async () => {
  serveFiles({
    "/repo/infra/catalog/recovery.yaml": JSON.stringify({
      objectives: [exportObjective],
    }),
  });
  expect(await loadRecovery("/repo")).toEqual([exportObjective]);
  expect(vi.mocked(readFile).mock.calls[0]?.[0]).toBe(
    "/repo/infra/catalog/recovery.yaml",
  );
});

test("a recovery file with no objectives list loads as no objectives", async () => {
  serveFiles({ "/repo/infra/catalog/recovery.yaml": "{}" });
  expect(await loadRecovery("/repo")).toEqual([]);
});

test("a stateful component is one whose values, chart or source declare a volume, sorted by name", async () => {
  serveFiles({
    "/repo/infra/values/db.yaml": "persistence:\n  enabled: true\n",
    "/repo/infra/charts/cache/values.yaml": "kind: PersistentVolumeClaim\n",
    "/repo/infra/values/web.yaml": "replicas: 2\n",
  });
  serveDirectories({ "/repo/infra/charts/cache": ["values.yaml"] });
  vi.mocked(exists).mockImplementation(async (path) =>
    [
      "/repo/infra/values/db.yaml",
      "/repo/infra/charts/cache/values.yaml",
      "/repo/infra/values/web.yaml",
    ].includes(path),
  );
  const repository = fakeRepository({
    catalog: {
      components: [
        {
          name: "db",
          kind: "helm",
          chart: "db",
          values: ["infra/values/db.yaml"],
        },
        { name: "cache", kind: "local-chart", source: "infra/charts/cache" },
        {
          name: "web",
          kind: "local-chart",
          chart: "web",
          values: ["infra/values/web.yaml"],
        },
        {
          name: "remote",
          kind: "helm",
          source: "https://charts.example.dev/x",
        },
      ],
    },
    environment: {},
  });
  expect(await statefulComponents("/repo", repository)).toEqual([
    "cache",
    "db",
  ]);
});

test("a declared file that is not on disk does not make its component stateful", async () => {
  serveFiles({});
  serveDirectories({});
  vi.mocked(exists).mockResolvedValue(false);
  const repository = fakeRepository({
    catalog: {
      components: [
        {
          name: "gone",
          kind: "local-chart",
          chart: "gone",
          values: ["infra/gone.yaml"],
        },
      ],
    },
    environment: {},
  });
  expect(await statefulComponents("/repo", repository)).toEqual([]);
});

test("checkRecovery counts the objectives and passes when the restore test is on disk", async () => {
  serveFiles({
    "/repo/infra/catalog/recovery.yaml": JSON.stringify({
      objectives: [exportObjective],
    }),
  });
  vi.mocked(exists).mockImplementation(
    async (path) => path === "/repo/tests/db.live.spec.ts",
  );
  const repository = fakeRepository({
    catalog: { components: [{ name: "db", kind: "helm", chart: "db" }] },
    environment: {},
  });
  expect(await checkRecovery(repository)).toEqual({
    problems: [],
    objectives: 1,
    stateful: [],
  });
});

test("checkRecovery reports a restore test that is missing from disk", async () => {
  serveFiles({
    "/repo/infra/catalog/recovery.yaml": JSON.stringify({
      objectives: [exportObjective],
    }),
  });
  vi.mocked(exists).mockResolvedValue(false);
  const repository = fakeRepository({
    catalog: { components: [{ name: "db", kind: "helm", chart: "db" }] },
    environment: {},
  });
  expect(await checkRecovery(repository)).toEqual({
    problems: ["database: restoreTest tests/db.live.spec.ts does not exist"],
    objectives: 1,
    stateful: [],
  });
});
