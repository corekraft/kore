import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, nodeCount } from "../../src/config/index.js";
import {
  goldenPathFeasibility,
  renderGoldenPathWorkload,
} from "../../src/testing/index.js";

// Docs: docs/decisions/0036-rollout-feasibility-and-container-smoke.md
// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
// Opt-in: it renders the golden-path-workload chart with helm and parses it
// with yq, and fast tests run offline (AGENTS.md). Run with
// `npm run test:upstream-charts` when bumping the chart or changing its defaults.

for (const overlay of ["local", "managed-example", "vps"]) {
  test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
    `the flag-on golden-path workload can roll out and drain on the ${overlay} overlay's declared node count`,
    async () => {
      const repository = await loadRepository(overlay);
      const problems = await goldenPathFeasibility(repository.environment, () =>
        renderGoldenPathWorkload(repository),
      );
      assert.deepEqual(
        problems,
        [],
        `${overlay} on ${nodeCount(repository.environment)} node(s)`,
      );
    },
    300_000,
  );
}

test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "the golden-path render the check judges holds both workloads and their budgets, so an empty render cannot pass",
  async () => {
    const repository = await loadRepository("local");
    const manifests = (await renderGoldenPathWorkload(repository)) as {
      kind?: string;
      metadata?: { name?: string };
    }[];
    const names = (kind: string) =>
      manifests
        .filter((doc) => doc.kind === kind)
        .map((doc) => doc.metadata?.name ?? "")
        .sort((a, b) => a.localeCompare(b));
    assert.deepEqual(names("Deployment"), ["auth-bff", "auth-frontend"]);
    assert.deepEqual(names("PodDisruptionBudget"), [
      "auth-bff",
      "auth-frontend",
    ]);
  },
  300_000,
);
