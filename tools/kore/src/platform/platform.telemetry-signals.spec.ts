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

test("every reference dashboard panel names the provisioned datasource for its signal", async () => {
  // A panel without a datasource falls back to Grafana's default (Prometheus),
  // which cannot run LogQL or TraceQL, so the logs and traces panels stay empty.
  const repository = await loadRepository("local");
  const grafana = await readFile(
    join(repository.root, "infra/environments/local/values/grafana.yaml"),
    "utf8",
  );
  const provisioned = new Map(
    [...grafana.matchAll(/type: (\w+),\s+uid: (\w+),/g)].map(
      ([, type, uid]) => [uid, type] as const,
    ),
  );
  const dashboard = await readJson(
    "infra/observability/config/files/dashboards/reference.json",
  );
  const expected: Record<string, string> = {
    timeseries: "prometheus",
    logs: "loki",
    traces: "tempo",
  };
  for (const panel of dashboard.panels as Json[]) {
    const signal = expected[panel["type"]];
    assert.ok(signal, `panel ${panel["title"]} has a known type`);
    for (const ref of [
      panel["datasource"],
      ...panel["targets"].map((t: Json) => t["datasource"]),
    ]) {
      assert.equal(ref?.type, signal, `${panel["title"]} datasource type`);
      assert.equal(
        provisioned.get(ref?.uid),
        signal,
        `${panel["title"]} uses a provisioned ${signal} uid`,
      );
    }
  }
});

test("the single-node local Loki gateway drops the chart's hard anti-affinity and replaces its pod without a surge", async () => {
  // The chart requires one gateway pod per node. On one node the surge pod of
  // any gateway rollout can never schedule, and the upgrade times out. Helm
  // merges maps, so only null (not {}) removes the default.
  const repository = await loadRepository("local");
  const values = await readFile(
    join(repository.root, "infra/environments/local/values/loki.yaml"),
    "utf8",
  );
  assert.match(values, /^gateway:/m);
  assert.match(values, /^\s+affinity: null$/m);
  // Anti-affinity is symmetric: the old pod still carries the chart's rule and
  // rejects a surge pod, so the single replica must be replaced, never surged.
  assert.match(values, /maxSurge: 0/);
  assert.match(values, /maxUnavailable: 1/);
});
