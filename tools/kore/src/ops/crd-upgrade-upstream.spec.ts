import assert from "node:assert/strict";
import { test } from "vitest";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";
import { ProcessRunner } from "../runtime/index.js";
import { crdRollbackProblems, crdUpgradeProblems } from "./crd-compat.js";
import { chartCrds, helmChartComponents } from "./crd-render.js";
import { previousRelease, snapshotAt } from "./upgrade.js";

// Opt-in: it pulls every pinned chart at two versions, and fast tests run
// offline (AGENTS.md). Run with `npm run test:upstream-charts` before a
// controller upgrade, or whenever a chart pin moves.
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "every chart upgrade from the previous release keeps its CRDs upgradable and rollback-safe",
  { timeout: 600_000 },
  async () => {
    const root = await findRoot();
    const repository = await loadRepository("local", root);
    const runner = new ProcessRunner();
    const from =
      process.env["KORE_UPGRADE_FROM"] ?? (await previousRelease(runner, root));
    const before = await snapshotAt(runner, root, from);
    const problems: string[] = [];
    for (const component of helmChartComponents(
      repository.catalog.components,
    )) {
      const old = before.components[component.name];
      const now = repository.versions.components[component.version];
      if (!old || !now || old === now) {
        continue;
      }
      const [oldCrds, newCrds] = await Promise.all([
        chartCrds(runner, root, component, old),
        chartCrds(runner, root, component, now),
      ]);
      problems.push(
        ...[
          ...crdUpgradeProblems(oldCrds, newCrds),
          ...crdRollbackProblems(oldCrds, newCrds),
        ].map((problem) => `${component.name} ${old} -> ${now}: ${problem}`),
      );
    }
    assert.deepEqual(problems, []);
  },
);
