// Opt-in (KORE_RUN_LIVE=1): renders the enabled components of the real catalog with helm and yq,
// and reports the pod requests of the rendered releases (#1596). It contacts no cluster, but it
// needs helm, yq, the network a remote chart fetch needs, and the two release locks the platform
// composes its delivery values from: the chart lock and the template lock a release publishes.
// It is a module, not a spec: those locks are release assets outside the repository, so no nightly
// suite can supply them, and a test registered here would fail the nightly guard
// (runtime/nightly-suites.spec.ts). Run it by hand on a built tree:
//   KORE_RUN_LIVE=1 KORE_PLATFORM_CHART_LOCK=<platform-charts.lock.json> \
//     KORE_PLATFORM_TEMPLATE_LOCK=<template-images.lock.json> \
//     node dist/src/platform/platform-requests.live.js
// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md

import { pathToFileURL } from "node:url";
import {
  type PlatformRequests,
  enabledComponents,
  findRoot,
  loadRepository,
  nodeCount,
} from "../config/index.js";
import { ProcessRunner, liveEnvironment } from "../runtime/index.js";
import { composeChartDelivery } from "./chart-delivery.js";
import { composeGoldenPathDelivery } from "./golden-path-delivery.js";
import { helmRenderer, platformRequests } from "./platform-requests.js";

/**
 * The platform's pod requests over the enabled components of the real catalog, with the release
 * locks composed in as `kore local up` composes them. Every missing input is named in the result.
 */
export async function renderPlatformRequests(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PlatformRequests> {
  const chartLock = env["KORE_PLATFORM_CHART_LOCK"];
  const templateLock = env["KORE_PLATFORM_TEMPLATE_LOCK"];
  if (!chartLock || !templateLock) {
    throw new Error(
      "KORE_PLATFORM_CHART_LOCK and KORE_PLATFORM_TEMPLATE_LOCK must name the platform-charts.lock.json and template-images.lock.json the release publishes",
    );
  }
  const runner = new ProcessRunner();
  const repository = await composeGoldenPathDelivery(
    await composeChartDelivery(
      await loadRepository(liveEnvironment(), await findRoot()),
      chartLock,
    ),
    runner,
    templateLock,
  );
  return platformRequests(
    enabledComponents(repository),
    nodeCount(repository.environment),
    helmRenderer(repository, runner),
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.env["KORE_RUN_LIVE"] !== "1") {
    throw new Error("set KORE_RUN_LIVE=1 to render the real catalog with helm");
  }
  console.log(JSON.stringify(await renderPlatformRequests(), null, 2));
}
