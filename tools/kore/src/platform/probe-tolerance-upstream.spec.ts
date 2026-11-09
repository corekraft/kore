import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { livenessProbeProblems } from "./probe-tolerance.js";
import { renderChart, yamlDocuments } from "./upstream-support.js";

// A liveness probe under this gives up on a healthy controller when the host
// is busy (cloudnative-pg restarted 25 times in 12 hours with a 1s probe).
const floorSeconds = 5;

// A chart that gives no knob for its probe is patched through the catalog's
// `patches` (ADR 0081), not listed here. Add an entry, with the reason, only
// when a probe cannot be patched either; the check reports a stale entry.
const noChartKnob: Record<string, string> = {};

// Opt-in: it renders every chart component with the local values, and fast
// tests run offline (AGENTS.md). Run with `npm run test:upstream-charts` when
// bumping a chart or changing local values.
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "no platform liveness probe times out under the floor, so load cannot kill a healthy controller",
  async () => {
    const repository = await loadRepository("local");
    const charts = repository.catalog.components!.filter(
      (component) => component.kind !== "manifest",
    );
    const problems = (
      await Promise.all(
        charts.map(async (component) =>
          livenessProbeProblems(
            component.name,
            await yamlDocuments(await renderChart(repository, component)),
            floorSeconds,
            noChartKnob,
          ),
        ),
      )
    ).flat();
    assert.deepEqual(problems, []);
  },
  600_000,
);
