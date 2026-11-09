import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { platformStatus } from "./status.js";
import { renderChart } from "./upstream-support.js";

type Json = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any

const gateway = "infra/observability/collector/values.yaml";
const backends = ["prometheus", "loki", "tempo", "grafana"];
const telemetryComponents = ["otel-collector", "otel-agent", ...backends];

async function readText(path: string): Promise<string> {
  const { root } = await loadRepository("local");
  return readFile(join(root, path), "utf8");
}

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readText(path));
}

test("each signal reaches its own backend through the Collector OTLP receiver", async () => {
  const { config } = await readJson(gateway);
  const pipelines = config.service.pipelines;
  const backendOf = (exporter: string): string => {
    const endpoint: string = config.exporters[exporter].endpoint;
    return endpoint.replace(/^https?:\/\//, "").split(/[:/]/)[0]!;
  };
  assert.deepEqual(pipelines.metrics.receivers, ["otlp"]);
  assert.deepEqual(pipelines.logs.receivers, ["otlp"]);
  assert.deepEqual(pipelines.traces.receivers, ["otlp"]);
  assert.deepEqual(pipelines.logs.exporters, ["otlp_http/loki"]);
  assert.deepEqual(pipelines.traces.exporters, ["otlp_grpc/tempo"]);
  assert.deepEqual(pipelines.metrics.exporters, ["prometheus"]);
  const repository = await loadRepository("local");
  const names = repository.catalog.components.map(({ name }) => name);
  assert.ok(names.includes(backendOf("otlp_http/loki")));
  assert.ok(names.includes(backendOf("otlp_grpc/tempo")));
  // Prometheus pulls metrics from the exporter instead of receiving a push.
  const prometheus = await readText(
    "infra/environments/local/values/prometheus.yaml",
  );
  assert.match(prometheus, /otel-collector\.observability\.svc:8889/);
});

test("Grafana links a trace to its logs and a log to its trace by trace id", async () => {
  const text = await readText("infra/environments/local/values/grafana.yaml");
  const tempo = text.slice(text.indexOf("type: tempo"));
  assert.match(tempo, /tracesToLogsV2:\s*\{[^}]*datasourceUid: loki/);
  assert.match(tempo, /filterByTraceID: true/);
  const loki = text.slice(
    text.indexOf("type: loki"),
    text.indexOf("type: tempo"),
  );
  assert.match(loki, /derivedFields:/);
  assert.match(loki, /datasourceUid: tempo/);
  assert.match(loki, /matcherRegex: trace_id/);
  assert.match(loki, /url: "\$\{__value\.raw\}"/);
});

test("Istio workload identity reaches Prometheus from ztunnel through the default pod scrape", async () => {
  // ztunnel pods carry prometheus.io/scrape and port 15020 (verified against the
  // pinned chart by the opt-in upstream spec); its TCP metrics carry
  // source_principal and destination_principal. The chart's kubernetes-pods
  // job must therefore stay in place, never replaced by a custom scrape list.
  const values = await readJson(
    "infra/environments/local/values/prometheus.yaml",
  );
  assert.equal(values.serverFiles["prometheus.yml"].scrape_configs, undefined);
  assert.equal(values.serverFiles["prometheus.yml"].global, undefined);
  const dashboard = await readJson(
    "infra/observability/config/files/dashboards/mesh-identity.json",
  );
  const exprs: string = JSON.stringify(dashboard.panels);
  assert.match(exprs, /istio_tcp_connections_opened_total/);
  assert.match(exprs, /source_principal/);
  assert.match(exprs, /destination_principal/);
});

test("OPA decision logs keep the trace headers that correlate a decision with its trace", async () => {
  const chart = await readText(
    "infra/charts/opa-authorizer/templates/all.yaml",
  );
  assert.match(chart, /decision_logs\.console=true/);
  const agent = await readJson("infra/observability/agent/values.yaml");
  const excluded: string[] = agent.config.receivers.file_log.exclude;
  assert.ok(
    excluded.every((pattern) => !pattern.includes("opa-system")),
    "the node agent collects OPA pod logs",
  );
  const mask = await readText("infra/policies/opa/bundles/v1/mask.rego");
  assert.doesNotMatch(mask, /traceparent|x-request-id|tracestate/);
  const spec = await readText("infra/policies/opa/bundles/v1/mask.spec.rego");
  assert.match(spec, /test_keeps_trace_headers_for_decision_correlation/);
});

test("the rule set alerts on a Collector exporter failure so a backend outage is visible", async () => {
  const rules = await readJson(
    "infra/observability/config/files/rules/platform.yaml",
  );
  const failure = rules.groups
    .flatMap((group: Json) => group.rules)
    .find((rule: Json) => rule.alert === "KoreCollectorExporterFailure");
  assert.match(failure.expr, /exporter_send_failed/);
});

for (const name of telemetryComponents) {
  test(`status names ${name} when its workload is not ready`, async () => {
    const repository = await loadRepository("local");
    const component = repository.catalog.components.find(
      (entry) => entry.name === name,
    )!;
    assert.ok(component.readiness?.length, `${name} declares readiness`);
    repository.catalog.components = [{ ...component, dependencies: [] }];
    const runner: Runner = {
      async run(command, args) {
        if (command === "helm") {
          return {
            stdout: JSON.stringify({ info: { status: "deployed" } }),
            stderr: "",
            code: 0,
          };
        }
        if (args.includes("rollout")) {
          throw new Error("timed out waiting for the condition");
        }
        return { stdout: "available", stderr: "", code: 0 };
      },
    };

    const [status] = await platformStatus(repository, runner);

    assert.equal(status?.name, name);
    assert.equal(status?.status, "degraded");
    assert.match(status!.detail, new RegExp(component.readiness![0]!));
  });
}

const backendHosts =
  /\b(loki|tempo|prometheus(-server)?|grafana)\b(\.[\w.-]+)?:\d+/;
const standardOtelVariables = new Set([
  "OTEL_SERVICE_NAME",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter(({ name }) => name !== "node_modules")
      .map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : [path];
      }),
  );
  return nested.flat();
}

test("no application names a storage backend and only standard OTEL variables are set", async () => {
  const { root } = await loadRepository("local");
  const files = (await sourceFiles(join(root, "apps"))).filter(
    (path) => !/\.(test|spec)\.ts$/.test(path) && !path.includes("/testing/"),
  );
  assert.ok(files.length > 0);
  for (const path of files) {
    const text = await readFile(path, "utf8");
    const name = relative(root, path);
    assert.doesNotMatch(text, backendHosts, `${name} addresses a backend`);
    for (const [variable] of text.matchAll(/OTEL_[A-Z_]+/g)) {
      assert.ok(
        standardOtelVariables.has(variable),
        `${name} sets non-documented ${variable}`,
      );
    }
  }
});

test("the endpoint an application receives is the Collector, never a backend port", async () => {
  const repository = await loadRepository("local");
  const environment = await readText(
    "infra/environments/local/environment.yaml",
  );
  const endpoints = [...environment.matchAll(/otlpEndpoint": "([^"]+)"/g)].map(
    (match) => match[1]!,
  );
  assert.ok(endpoints.length > 0);
  for (const endpoint of endpoints) {
    assert.equal(endpoint, `http://otel-collector.observability.svc:4318`);
  }
  assert.ok(
    repository.catalog.components.some(({ name }) => name === "otel-collector"),
  );
});

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
