import { beforeEach, expect, test, vi } from "vitest";
import { crdRollbackProblems, crdUpgradeProblems } from "./crd-compat.js";
import { chartCrds, helmChartComponents } from "./crd-render.js";
import { buildInventory, type Inventory } from "./inventory.js";
import { integrityProblems } from "./inventory-problems.js";
import { checkRecovery } from "./recovery.js";
import { fakeRepository, fakeRunner } from "./ops-support.js";
import { opsReport } from "./report.js";
import { previousRelease, snapshotAt, upgradeCheck } from "./upgrade.js";

// Every ops unit the report dispatches to is mocked, so each test shows the
// verdict and the routing of one action and nothing else.

vi.mock("./crd-compat.js");
vi.mock("./crd-render.js");
vi.mock("./inventory.js");
vi.mock("./inventory-problems.js");
vi.mock("./recovery.js");
vi.mock("./upgrade.js");

const { runner } = fakeRunner();
const repository = fakeRepository({
  versions: { components: { demo: "1.1.0" } },
  catalog: {
    components: [
      { name: "demo", kind: "helm", version: "demo", chart: "demo" },
    ],
  },
});

const inventory = (items: Inventory["items"]): Inventory => ({
  items,
  misePins: {},
  npmRanges: {},
  authorizedSigners: [],
});

beforeEach(() => {
  vi.mocked(buildInventory).mockResolvedValue(
    inventory([
      { kind: "npm", name: "a", version: "1.0.0", source: "s" },
      { kind: "npm", name: "b", version: "1.0.0", source: "s" },
      { kind: "tool", name: "helm", version: "4.3.1", source: "s" },
    ]),
  );
  vi.mocked(integrityProblems).mockReturnValue([]);
});

test("inventory counts its items by kind and passes when no pin is loose", async () => {
  expect(
    await opsReport("inventory", { repository, runner, json: false }),
  ).toEqual({
    ok: true,
    report: {
      status: "valid",
      counts: { npm: 2, tool: 1 },
      problems: [],
    },
  });
  expect(buildInventory).toHaveBeenCalledWith("/repo");
});

test("inventory lists every item only with --json, and fails when a pin is loose", async () => {
  vi.mocked(integrityProblems).mockReturnValue(["tool helm: loose"]);
  const built = inventory([
    { kind: "tool", name: "helm", version: "^4", source: "s" },
  ]);
  vi.mocked(buildInventory).mockResolvedValue(built);
  expect(
    await opsReport("inventory", { repository, runner, json: true }),
  ).toEqual({
    ok: false,
    report: {
      status: "invalid",
      counts: { tool: 1 },
      items: built.items,
      problems: ["tool helm: loose"],
    },
  });
  expect(integrityProblems).toHaveBeenCalledWith(built);
});

test("recovery reports the objectives and the stateful components it checked", async () => {
  vi.mocked(checkRecovery).mockResolvedValue({
    problems: [],
    objectives: 3,
    stateful: ["db"],
  });
  expect(
    await opsReport("recovery", { repository, runner, json: false }),
  ).toEqual({
    ok: true,
    report: { status: "valid", objectives: 3, stateful: ["db"], problems: [] },
  });
  expect(checkRecovery).toHaveBeenCalledWith(repository);
});

test("recovery fails with its problems listed when an objective is wrong", async () => {
  vi.mocked(checkRecovery).mockResolvedValue({
    problems: ["db: stateful component has no local recovery objective"],
    objectives: 0,
    stateful: ["db"],
  });
  const { ok, report } = await opsReport("recovery", {
    repository,
    runner,
    json: false,
  });
  expect(ok).toBe(false);
  expect(report["status"]).toBe("invalid");
});

test("upgrade-check uses the given release and reports its changes", async () => {
  vi.mocked(upgradeCheck).mockResolvedValue({
    from: "v0.3.0",
    changes: [{ name: "demo", from: "1.0.0", to: "1.1.0" }],
    problems: [],
  });
  expect(
    await opsReport("upgrade-check", {
      repository,
      runner,
      json: false,
      from: "v0.3.0",
    }),
  ).toEqual({
    ok: true,
    report: {
      status: "valid",
      from: "v0.3.0",
      changes: [{ name: "demo", from: "1.0.0", to: "1.1.0" }],
      problems: [],
    },
  });
  expect(previousRelease).not.toHaveBeenCalled();
  expect(upgradeCheck).toHaveBeenCalledWith(runner, "/repo", "v0.3.0");
});

test("upgrade-check defaults to the newest release tag", async () => {
  vi.mocked(previousRelease).mockResolvedValue("v0.4.0");
  vi.mocked(upgradeCheck).mockResolvedValue({
    from: "v0.4.0",
    changes: [],
    problems: ["kubernetes: skips a minor version"],
  });
  const { ok, report } = await opsReport("upgrade-check", {
    repository,
    runner,
    json: false,
  });
  expect(ok).toBe(false);
  expect(report["from"]).toBe("v0.4.0");
  expect(previousRelease).toHaveBeenCalledWith(runner, "/repo");
});

test("crd-check renders only the charts whose version moved, at both versions", async () => {
  const twoCharts = fakeRepository({
    versions: { components: { demo: "1.1.0", other: "2.0.0" } },
    catalog: {
      components: [
        { name: "demo", kind: "helm", version: "demo", chart: "demo" },
        { name: "other", kind: "helm", version: "other", chart: "other" },
      ],
    },
  });
  vi.mocked(snapshotAt).mockResolvedValue({
    kubernetes: "1.36.0",
    components: { demo: "1.0.0", other: "2.0.0" },
  });
  vi.mocked(helmChartComponents).mockImplementation((components) => components);
  vi.mocked(chartCrds).mockResolvedValue([]);
  vi.mocked(crdUpgradeProblems).mockReturnValue([]);
  vi.mocked(crdRollbackProblems).mockReturnValue([]);
  const { ok, report } = await opsReport("crd-check", {
    repository: twoCharts,
    runner,
    json: false,
    from: "v0.4.0",
  });
  expect(ok).toBe(true);
  expect(report).toEqual({
    status: "valid",
    from: "v0.4.0",
    checked: ["demo"],
    problems: [],
  });
  expect(vi.mocked(chartCrds).mock.calls.map((call) => call[3])).toEqual([
    "1.0.0",
    "1.1.0",
  ]);
});

test("crd-check names the chart and both versions on each problem", async () => {
  vi.mocked(snapshotAt).mockResolvedValue({
    kubernetes: "1.36.0",
    components: { demo: "1.0.0" },
  });
  vi.mocked(helmChartComponents).mockImplementation((components) => components);
  vi.mocked(chartCrds).mockResolvedValue([]);
  vi.mocked(crdUpgradeProblems).mockReturnValue([
    "w: stored version v1 is gone",
  ]);
  vi.mocked(crdRollbackProblems).mockReturnValue([
    "w: rollback cannot read v2",
  ]);
  const { ok, report } = await opsReport("crd-check", {
    repository,
    runner,
    json: false,
    from: "v0.4.0",
  });
  expect(ok).toBe(false);
  expect(report["problems"]).toEqual([
    "demo 1.0.0 -> 1.1.0: w: stored version v1 is gone",
    "demo 1.0.0 -> 1.1.0: w: rollback cannot read v2",
  ]);
});

test("an unknown ops action is rejected with the supported list", async () => {
  await expect(
    opsReport("nope", { repository, runner, json: false }),
  ).rejects.toThrow(
    "unknown ops action nope; use inventory, recovery, upgrade-check, or crd-check",
  );
});
