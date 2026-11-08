import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository, orderedComponents } from "../config/index.js";

type Json = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any

async function readJson(path: string): Promise<Json> {
  const repository = await loadRepository("local");
  return JSON.parse(await readFile(join(repository.root, path), "utf8"));
}

async function readText(path: string): Promise<string> {
  const repository = await loadRepository("local");
  return readFile(join(repository.root, path), "utf8");
}

const gateway = "infra/observability/collector/values.yaml";
const agent = "infra/observability/agent/values.yaml";
const rules = "infra/observability/config/files/rules/platform.yaml";

test("the Collector exposes its Prometheus exporter and its own telemetry ports", async () => {
  const ports = (await readJson(gateway)).ports;
  assert.equal(ports.prometheus.containerPort, 8889);
  assert.equal(ports.prometheus.enabled, true);
  assert.equal(ports.metrics.enabled, true);
  assert.equal(ports.metrics.containerPort, 8888);
});

test("Prometheus scrapes the Collector exporter and the Collector's own metrics", async () => {
  const values = await readJson(
    "infra/environments/local/values/prometheus.yaml",
  );
  const scrape = JSON.parse(values.extraScrapeConfigs);
  const targets = scrape.flatMap((job: Json) =>
    job.static_configs.flatMap((config: Json) => config.targets),
  );
  assert.ok(targets.includes("otel-collector.observability.svc:8889"));
  assert.ok(targets.includes("otel-collector.observability.svc:8888"));
});

test("Prometheus loads the platform rule files from the owning ConfigMap", async () => {
  const values = await readJson(
    "infra/environments/local/values/prometheus.yaml",
  );
  const mount = values.server.extraConfigmapMounts.find(
    ({ configMap }: Json) => configMap === "kore-prometheus-rules",
  );
  assert.ok(mount);
  const ruleFiles = values.serverFiles["prometheus.yml"].rule_files;
  assert.ok(ruleFiles.includes(`${mount.mountPath}/platform.yaml`));
  assert.ok(ruleFiles.includes("/etc/config/alerting_rules.yml"));
  assert.equal(values.alertmanager.enabled, false);
});

test("observability config is installed before Prometheus and Grafana mount it", async () => {
  const repository = await loadRepository("local");
  const order = orderedComponents(repository.catalog).map(({ name }) => name);
  const config = repository.catalog.components.find(
    ({ name }) => name === "kore-observability-config",
  )!;
  assert.equal(config.kind, "local-chart");
  assert.equal(config.namespace, "observability");
  assert.ok(order.indexOf(config.name) < order.indexOf("prometheus"));
  assert.ok(order.indexOf(config.name) < order.indexOf("grafana"));
});

test("Grafana provisions the reference dashboard from the ConfigMap that owns it", async () => {
  const values = await readText("infra/environments/local/values/grafana.yaml");
  assert.match(
    values,
    /dashboardsConfigMaps:\s*\n\s+kore: kore-grafana-dashboards/,
  );
  assert.match(values, /path: \/var\/lib\/grafana\/dashboards\/kore/);
  const template = await readText(
    "infra/observability/config/templates/grafana-dashboards.yaml",
  );
  assert.match(template, /name: kore-grafana-dashboards/);
  assert.match(template, /\.Files\.Glob "files\/dashboards\/\*\.json"/);
  const dashboard = await readJson(
    "infra/observability/config/files/dashboards/reference.json",
  );
  assert.equal(dashboard.title, "Kore Reference");
});

test("alert rules watch Collector health, queues, dropped data, and exporter failures", async () => {
  const groups = (await readJson(rules)).groups;
  const alerts = groups.flatMap((group: Json) => group.rules);
  const names = alerts.map(({ alert }: Json) => alert);
  for (const name of [
    "KoreCollectorDown",
    "KoreCollectorQueueNearCapacity",
    "KoreCollectorDroppedData",
    "KoreCollectorExporterFailure",
  ]) {
    assert.ok(names.includes(name), name);
  }
  for (const { expr } of alerts) {
    assert.doesNotMatch(expr, /_(spans|metric_points|log_records)\[/);
  }
  const template = await readText(
    "infra/observability/config/templates/prometheus-rules.yaml",
  );
  assert.match(template, /name: kore-prometheus-rules/);
});

test("rule unit tests exist and run through a pinned promtool", async () => {
  const mise = await readText(".mise.toml");
  assert.match(mise, /promtool = "3\.16\.0"/);
  assert.match(mise, /\[tasks\.test-promtool\]/);
  const repository = await loadRepository("local");
  assert.equal(repository.versions.tools.promtool, "3.16.0");
  const tests = await readText(
    "infra/observability/config/tests/platform.test.yaml",
  );
  assert.match(tests, /KoreCollectorQueueNearCapacity/);
});

test("signals carry cluster, environment, and part-of attributes from environment config", async () => {
  const base = await readJson(gateway);
  assert.ok(
    base.config.processors.k8sattributes.extract.labels.some(
      ({ key }: Json) => key === "app.kubernetes.io/part-of",
    ),
  );
  const repository = await loadRepository("local");
  const overlay = await readJson(
    "infra/environments/local/values/otel-collector.yaml",
  );
  const attributes =
    overlay.config.processors["resource/environment"].attributes;
  const byKey = Object.fromEntries(
    attributes.map(({ key, value }: Json) => [key, value]),
  );
  assert.equal(byKey["k8s.cluster.name"], repository.environment.kubeContext);
  assert.equal(
    byKey["deployment.environment.name"],
    repository.environment.name,
  );
  assert.deepEqual(repository.environment.componentValues?.["otel-collector"], [
    "infra/environments/local/values/otel-collector.yaml",
  ]);
  for (const pipeline of Object.values<Json>(base.config.service.pipelines)) {
    assert.ok(pipeline.processors.includes("resource/environment"));
  }
});

test("pod-level and unbounded attributes never reach Prometheus", async () => {
  const { config } = await readJson(gateway);
  const metrics = config.service.pipelines.metrics;
  assert.ok(metrics.processors.includes("transform/metric-cardinality"));
  const statements = JSON.stringify(
    config.processors["transform/metric-cardinality"],
  );
  assert.match(statements, /keep_matching_keys/);
  assert.doesNotMatch(statements, /k8s\.pod\.name\b(?!.*delete)/);
  const allowlist = statements.match(/\^\(([^)]*)\)/)?.[1] ?? "";
  assert.ok(!allowlist.includes("k8s.pod.name"));
  assert.ok(!allowlist.includes("k8s.pod.uid"));
  // logs and traces keep pod identity for correlation
  assert.ok(
    !config.service.pipelines.logs.processors.includes(
      "transform/metric-cardinality",
    ),
  );
});

test("Kubernetes sources run as separate pipelines with minimal RBAC", async () => {
  const gatewayValues = await readJson(gateway);
  const pipelines = gatewayValues.config.service.pipelines;
  assert.deepEqual(pipelines["metrics/cluster"].receivers, ["k8s_cluster"]);
  assert.ok(
    pipelines["metrics/cluster"].processors.includes("filter/cluster-no-pod"),
  );
  const verbs = gatewayValues.clusterRole.rules.flatMap(
    (rule: Json) => rule.verbs,
  );
  assert.deepEqual(
    [...new Set<string>(verbs)].sort((a, b) => a.localeCompare(b)),
    ["get", "list", "watch"],
  );

  const values = await readJson(agent);
  assert.equal(values.mode, "daemonset");
  assert.deepEqual(values.config.service.pipelines["logs/pods"].receivers, [
    "filelog",
  ]);
  assert.deepEqual(
    values.config.service.pipelines["metrics/kubelet"].receivers,
    ["kubeletstats"],
  );
  assert.deepEqual(values.config.receivers.kubeletstats.metric_groups, [
    "node",
  ]);
  assert.match(values.config.receivers.filelog.exclude.join(), /otel-/);
  const verbsAgent = values.clusterRole.rules.flatMap(
    (rule: Json) => rule.verbs,
  );
  assert.deepEqual(
    [...new Set<string>(verbsAgent)].sort((a, b) => a.localeCompare(b)),
    ["get"],
  );
  assert.ok(
    values.config.exporters["otlp/gateway"].endpoint.startsWith(
      "otel-collector.",
    ),
  );
});

test("the node agent is its own release ordered after the gateway Collector", async () => {
  const repository = await loadRepository("local");
  const order = orderedComponents(repository.catalog).map(({ name }) => name);
  const component = repository.catalog.components.find(
    ({ name }) => name === "otel-agent",
  )!;
  assert.equal(component.chart, "opentelemetry-collector");
  assert.deepEqual(component.readiness, ["daemonset/otel-agent"]);
  assert.ok(order.indexOf("otel-collector") < order.indexOf("otel-agent"));
});

test("Istio sends traces to the Collector through a mesh Telemetry resource", async () => {
  const values = await readText("infra/environments/common/values/istiod.yaml");
  assert.match(values, /- name: otel-tracing\s+opentelemetry:/);
  assert.match(
    values,
    /service: otel-collector\.observability\.svc\.cluster\.local\s+port: 4317/,
  );
  assert.match(values, /- name: opa-authorizer/);
  const telemetry = await readText(
    "infra/observability/config/templates/istio-telemetry.yaml",
  );
  assert.match(telemetry, /kind: Telemetry/);
  assert.match(telemetry, /namespace: istio-system/);
  assert.match(telemetry, /name: otel-tracing/);
});
