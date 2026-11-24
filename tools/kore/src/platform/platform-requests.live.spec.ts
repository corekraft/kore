import assert from "node:assert/strict";
import test from "node:test";
import {
  enabledComponents,
  findRoot,
  loadRepository,
  nodeCount,
} from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import { composeChartDelivery } from "./chart-delivery.js";
import { composeGoldenPathDelivery } from "./golden-path-delivery.js";
import { helmRenderer, platformRequests } from "./platform-requests.js";

// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md
// Opt-in (KORE_RUN_LIVE=1): renders the enabled components of the real catalog with helm and yq,
// and reads the pod requests of the rendered releases (#1596). It contacts no cluster, but it needs
// helm, yq and the network a remote chart fetch needs, and the two release locks the platform
// composes its delivery values from: the chart lock and the template lock the release publishes.
//   KORE_RUN_LIVE=1 KORE_PLATFORM_CHART_LOCK=<platform-charts.lock.json> \
//     KORE_PLATFORM_TEMPLATE_LOCK=<template-images.lock.json> \
//     node --test dist/src/platform/platform-requests.live.spec.js

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_LIVE !== "1"
      ? "set KORE_RUN_LIVE=1 and both release locks to render the real catalog with helm"
      : false,
  timeout: 10 * 60 * 1000,
};

const manifestEntry = "is a manifest the platform cannot render offline";

test(
  "the real catalog's platform requests sum above zero, and name every manifest they cannot read and every pod they cannot size",
  live,
  async () => {
    const chartLock = process.env.KORE_PLATFORM_CHART_LOCK;
    const templateLock = process.env.KORE_PLATFORM_TEMPLATE_LOCK;
    assert.ok(
      chartLock,
      "KORE_PLATFORM_CHART_LOCK names the platform-charts.lock.json the release publishes",
    );
    assert.ok(
      templateLock,
      "KORE_PLATFORM_TEMPLATE_LOCK names the template-images.lock.json the release publishes",
    );
    const runner = new ProcessRunner();
    const repository = await composeGoldenPathDelivery(
      await composeChartDelivery(
        await loadRepository(liveEnvironment(), await findRoot()),
        chartLock,
      ),
      runner,
      templateLock,
    );
    const result = await platformRequests(
      enabledComponents(repository),
      nodeCount(repository.environment),
      helmRenderer(repository, runner),
    );
    assert.ok(result.requests.cpuMillis > 0, "the platform requests CPU");
    assert.ok(result.requests.memoryMiB > 0, "the platform requests memory");
    for (const manifest of enabledComponents(repository).filter(
      (component) => component.kind === "manifest",
    )) {
      assert.ok(
        result.missing.some((entry) =>
          entry.startsWith(`${manifest.name} ${manifestEntry}`),
        ),
        `${manifest.name} is named as a manifest the platform cannot read`,
      );
    }
    // Nothing is silent: every entry is a named manifest or a named container with no readable request.
    const unnamed = result.missing.filter(
      (entry) =>
        !entry.includes(manifestEntry) && !entry.includes(" container "),
    );
    assert.deepEqual(
      unnamed,
      [],
      "every missing input names its manifest or its container",
    );
  },
);
