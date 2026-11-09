import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { livenessProbeProblems } from "./probe-tolerance.js";
import { renderChart, yamlDocuments } from "./upstream-support.js";

// A liveness probe under this gives up on a healthy controller when the host
// is busy (cloudnative-pg restarted 25 times in 12 hours with a 1s probe).
const floorSeconds = 5;

// Only charts that give no knob for the probe belong here, each with the
// reason. Remove an entry when a chart bump or a kore mechanism fixes it.
const noChartKnob: Record<string, string> = {
  "cloudnative-pg: Deployment/cloudnative-pg container manager":
    "chart 0.29.1 templates the probe with only initialDelaySeconds; no timeoutSeconds value",
  "opentelemetry-operator: Deployment/opentelemetry-operator container manager":
    "chart 0.129.0 hard-codes the probe with only initialDelaySeconds and periodSeconds",
  "policy-controller: Deployment/policy-controller-webhook container policy-controller-webhook":
    "chart 0.10.8 hard-codes the Knative kubelet probe; no probe values",
};

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
