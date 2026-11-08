import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

type Json = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any

async function readJson(path: string): Promise<Json> {
  const repository = await loadRepository("local");
  return JSON.parse(await readFile(join(repository.root, path), "utf8"));
}

const gateway = "infra/observability/collector/values.yaml";

test("Grafana queries Tempo on the HTTP API port the pinned chart serves", async () => {
  // `helm template tempo grafana/tempo --version 1.24.4` serves the query API on
  // `server.http_listen_port: 3200` (4317/4318 are OTLP, never the query API).
  // Re-check this when the pinned version changes.
  const chartVersion = "1.24.4";
  const tempoHttpPort = 3200;
  const repository = await loadRepository("local");
  assert.equal(repository.versions.components.tempo, chartVersion);
  const tempoValues = await readFile(
    join(repository.root, "infra/environments/local/values/tempo.yaml"),
    "utf8",
  );
  assert.doesNotMatch(tempoValues, /http_listen_port|^\s*server:/m);
  const grafana = await readFile(
    join(repository.root, "infra/environments/local/values/grafana.yaml"),
    "utf8",
  );
  assert.match(
    grafana,
    new RegExp(`type: tempo,[^}]*url: "http://tempo:${tempoHttpPort}"`),
  );
});

test("delta request counters are made cumulative before the Prometheus exporter", async () => {
  const config = (await readJson(gateway)).config;
  assert.ok(config.processors.deltatocumulative);
  const processors: string[] = config.service.pipelines.metrics.processors;
  assert.ok(processors.includes("deltatocumulative"));
  assert.ok(
    processors.indexOf("deltatocumulative") <
      processors.indexOf("transform/metric-cardinality"),
    "cumulative conversion precedes attribute trimming",
  );
});

test("the reference dashboard queries the metric name Prometheus actually stores", async () => {
  // OTLP `http.server.request.count` (monotonic sum, unit `{request}`) becomes
  // `http_server_request_count_total` in the Collector's Prometheus exporter.
  const dashboard = await readJson(
    "infra/observability/config/files/dashboards/reference.json",
  );
  const exprs: string[] = dashboard.panels
    .flatMap(({ targets }: Json) => targets)
    .map(({ expr }: Json) => expr)
    .filter(Boolean);
  const metric = exprs.find((expr) => expr.includes("http_server_request"));
  assert.ok(metric);
  assert.match(metric, /http_server_request_count_total/);
  assert.match(metric, /rate\(/);
});
