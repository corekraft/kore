import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { componentValues, loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
// Docs: docs/decisions/0128-forward-fired-service-alerts-from-the-metrics-store-to-grafana-s-alert-manager.md
// Issue: #1513 (vps observability stack: scrape, rules, Loki, Grafana datasources, retention)

type Json = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any

const isMap = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Helm's merge: maps merge key by key; lists and scalars from a later file replace. */
function merge(base: Json, layer: Json): Json {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(layer)) {
    const prior = out[key];
    out[key] = isMap(prior) && isMap(value) ? merge(prior, value) : value;
  }
  return out;
}

/** The values Helm renders a vps component with: the catalog file, then the vps overlay files, in order. */
async function vpsRender(name: string): Promise<Json> {
  const repository = await loadRepository("vps");
  const component = repository.catalog.components.find(
    (candidate) => candidate.name === name,
  );
  assert.ok(component, `${name} is a catalog component`);
  let rendered: Json = {};
  for (const path of componentValues(repository, component)) {
    const layer = JSON.parse(
      await readFile(join(repository.root, path), "utf8"),
    );
    rendered = merge(rendered, layer);
  }
  return rendered;
}

test("the vps Prometheus render scrapes both collector ports, the exporter and the self metrics, as local does", async () => {
  const prometheus = await vpsRender("prometheus");
  const jobs = new Map<string, string[]>();
  for (const line of String(prometheus["extraScrapeConfigs"]).split("\n")) {
    const scrape = JSON.parse(line.replace(/^- /, ""));
    jobs.set(scrape.job_name, scrape.static_configs[0].targets);
  }
  assert.deepEqual(jobs.get("otel-collector-exporter"), [
    "otel-collector.observability.svc:8889",
  ]);
  assert.deepEqual(jobs.get("otel-collector-self"), [
    "otel-collector.observability.svc:8888",
  ]);
});

test("the vps Prometheus render loads the platform rule file from the kore-prometheus-rules mount", async () => {
  const prometheus = await vpsRender("prometheus");
  assert.ok(
    prometheus["serverFiles"]["prometheus.yml"]["rule_files"].includes(
      "/etc/kore/rules/platform.yaml",
    ),
  );
  assert.deepEqual(prometheus["server"]["extraConfigmapMounts"], [
    {
      name: "kore-prometheus-rules",
      mountPath: "/etc/kore/rules",
      configMap: "kore-prometheus-rules",
      readOnly: true,
    },
    {
      name: "kore-prometheus-disk-rules",
      mountPath: "/etc/kore/disk-rules",
      configMap: "kore-prometheus-disk-rules",
      readOnly: true,
    },
  ]);
});

test("the vps Prometheus render loads the disk rule file from its own mount, so the disk alerts reach vps and no other environment", async () => {
  const prometheus = await vpsRender("prometheus");
  assert.ok(
    prometheus["serverFiles"]["prometheus.yml"]["rule_files"].includes(
      "/etc/kore/disk-rules/disk.yaml",
    ),
  );
});

test("the vps Prometheus render keeps metrics 15 days inside a size limit of 80 percent of a 20 GiB volume", async () => {
  const { server } = await vpsRender("prometheus");
  assert.equal(server.retention, "15d");
  assert.equal(server.persistentVolume.size, "20Gi");
  // Prometheus reads the size limit in base 2, so 16GB is 80 percent of 20Gi.
  assert.equal(server.retentionSize, "16GB");
  assert.equal(server.persistentVolume.enabled, true);
});

test("the vps Prometheus render turns off the Alertmanager, node exporter and push gateway that no approved image backs", async () => {
  const prometheus = await vpsRender("prometheus");
  assert.equal(prometheus["alertmanager"]["enabled"], false);
  assert.equal(prometheus["prometheus-node-exporter"]["enabled"], false);
  assert.equal(prometheus["prometheus-pushgateway"]["enabled"], false);
});

test("the vps Loki render runs as one binary on filesystem storage and keeps logs 14 days, enforced by the compactor", async () => {
  const loki = await vpsRender("loki");
  assert.equal(loki["deploymentMode"], "SingleBinary");
  assert.equal(loki["loki"]["storage"]["type"], "filesystem");
  assert.equal(loki["loki"]["limits_config"]["retention_period"], "336h");
  assert.equal(loki["loki"]["compactor"]["retention_enabled"], true);
  assert.equal(loki["loki"]["compactor"]["delete_request_store"], "filesystem");
  assert.equal(loki["singleBinary"]["replicas"], 1);
  assert.equal(loki["singleBinary"]["persistence"]["enabled"], true);
  assert.equal(loki["singleBinary"]["persistence"]["size"], "10Gi");
});

test("the vps Grafana render provisions the Prometheus, Loki and Tempo datasources at their in-cluster addresses", async () => {
  const grafana = await vpsRender("grafana");
  const datasources: Json[] =
    grafana["datasources"]["datasources.yaml"]["datasources"];
  const url = (name: string) =>
    datasources.find((source) => source["name"] === name)?.["url"];
  assert.equal(url("Prometheus"), "http://prometheus-server");
  assert.equal(url("Loki"), "http://loki:3100");
  assert.equal(url("Tempo"), "http://tempo:3200");
  assert.equal(grafana["persistence"]["size"], "2Gi");
  assert.equal(
    grafana["dashboardsConfigMaps"]["kore"],
    "kore-grafana-dashboards",
  );
});

test("the vps Tempo render keeps traces 7 days on the labelled tempo-storage claim the observability chart owns", async () => {
  const tempo = await vpsRender("tempo");
  assert.equal(tempo["tempo"]["retention"], "168h");
  assert.equal(tempo["persistence"]["enabled"], false);
  assert.deepEqual(tempo["extraVolumes"], [
    { name: "storage", persistentVolumeClaim: { claimName: "tempo-storage" } },
  ]);
});

test("the vps collector names its cluster kore-vps, never the REQUIRED placeholder", async () => {
  const collector = await vpsRender("otel-collector");
  const attributes: Json[] =
    collector["config"]["processors"]["resource/environment"]["attributes"];
  const cluster = attributes.find(
    (attribute) => attribute["key"] === "k8s.cluster.name",
  );
  assert.equal(cluster?.["value"], "kore-vps");
});

test("the vps overlay layers each observability values file beside the mirror values, so each render gets them", async () => {
  const repository = await loadRepository("vps");
  const layered = (name: string) =>
    repository.environment.componentValues?.[name] ?? [];
  assert.ok(
    layered("prometheus").includes(
      "infra/environments/vps/values/prometheus.yaml",
    ),
  );
  assert.ok(
    layered("loki").includes("infra/environments/vps/values/loki.yaml"),
  );
  assert.ok(
    layered("grafana").includes("infra/environments/vps/values/grafana.yaml"),
  );
  assert.ok(
    layered("tempo").includes("infra/environments/vps/values/tempo.yaml"),
  );
});
