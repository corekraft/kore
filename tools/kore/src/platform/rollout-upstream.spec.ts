import assert from "node:assert/strict";
import { test } from "vitest";
import {
  loadRepository,
  type Component,
  type Repository,
} from "../config/index.js";
import { rolloutProblems } from "./rollout-feasibility.js";
import { renderChart, yamlDocuments } from "./upstream-support.js";

// The environment schema declares no node count; local is a single k3d
// server node. Read it from the config here once an environment can declare it.
const localNodes = 1;

/**
 * The release already running, rendered without the environment's scheduling
 * overrides, so its pods' anti-affinity still applies to a surge pod. Kore-owned
 * charts have no upstream default release; a chart that still fails to render
 * has no baseline, which is printed rather than hidden.
 */
async function baseline(
  repository: Repository,
  component: Component,
): Promise<unknown[]> {
  if (component.kind !== "helm") {
    return [];
  }
  try {
    return await yamlDocuments(await renderChart(repository, component, true));
  } catch {
    console.log(
      `rollout check: no baseline for ${component.name}: the chart does not render without the environment values, so only its new template is checked`,
    );
    return [];
  }
}

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
          // The release already running was rendered without the overlays, so
          // its pods' anti-affinity still applies to a surge pod.
          const previous = await baseline(repository, component);
          return rolloutProblems(manifests, localNodes, previous).map(
            (problem) => `${component.name}: ${problem}`,
          );
        }),
      )
    ).flat();
    assert.deepEqual(problems, []);
  },
  300_000,
);
