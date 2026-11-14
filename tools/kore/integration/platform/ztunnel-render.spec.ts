import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import { renderChart } from "../../src/platform/upstream.live.js";

// Opt-in: renders the pinned ztunnel chart (needs helm, yq, and network).
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "the pinned ztunnel chart marks its pods for the Prometheus pod scrape on its metrics port",
  async () => {
    const repository = await loadRepository("local");
    const component = repository.catalog.components.find(
      ({ name }) => name === "ztunnel",
    )!;
    const rendered = await renderChart(repository, component);
    assert.match(rendered, /prometheus\.io\/scrape: "true"/);
    assert.match(rendered, /prometheus\.io\/port: "15020"/);
  },
);
