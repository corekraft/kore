import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { rolloutProblems } from "./rollout-feasibility.js";
import { renderChart, yamlDocuments } from "./upstream-support.js";

// The environment schema declares no node count; local is a single Minikube
// node. Read it from the config here once an environment can declare it.
const localNodes = 1;

// Opt-in: it renders every chart component with the local values, and fast
// tests run offline (AGENTS.md). Run with `npm run test:upstream-charts` when
// bumping a chart or changing local values.
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "every workload rendered with the local values can roll out and drain on the local node count",
  async () => {
    const repository = await loadRepository("local");
    const charts = repository.catalog.components!.filter(
      (component) => component.kind !== "manifest",
    );
    const problems = (
      await Promise.all(
        charts.map(async (component) => {
          const manifests = await yamlDocuments(
            await renderChart(repository, component),
          );
          return rolloutProblems(manifests, localNodes).map(
            (problem) => `${component.name}: ${problem}`,
          );
        }),
      )
    ).flat();
    assert.deepEqual(problems, []);
  },
  300_000,
);
