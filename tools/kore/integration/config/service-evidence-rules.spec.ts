import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md

const run = promisify(execFile);

type Json = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any

async function repoFile(path: string): Promise<string> {
  return readFile(join(await findRoot(), path), "utf8");
}

async function renderChart(chart: string, ...sets: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-test",
    join(root, chart),
    "--namespace",
    "observability",
    ...sets.flatMap((set) => ["--set-json", set]),
  ]);
  return stdout;
}

/** The names of the recording rules a rule file defines, in order. */
const recordedNames = (rules: string): string[] =>
  [...rules.matchAll(/^\s*- record: (\S+)$/gm)].map((match) => match[1]!);

/** Every recorded series a rendered dashboard or alert reads, by name. */
const readNames = (rendered: string): string[] => [
  ...new Set([...rendered.matchAll(/kore:[a-z0-9_:]+/g)].map((m) => m[0])),
];

/** Raw metric names and rate functions that must never reach a dashboard or alert. */
const rawMetric =
  /\b(kube_[a-z_]+|istio_[a-z_]+|otelcol_[a-z_]+)\b|\b(rate|increase)\(/;

const ruleFile = "infra/observability/config/files/rules/services.yaml";
const prometheusOverlay = "infra/environments/local/values/prometheus.yaml";
const commonPrometheus = "infra/environments/common/values/prometheus.yaml";

test("the service recording rules are loaded: the ConfigMap carries the file and Prometheus lists its mounted path in rule_files", async () => {
  const rendered = await renderChart("infra/observability/config");
  const configMap = rendered.slice(
    rendered.indexOf("name: kore-prometheus-rules"),
  );
  assert.match(configMap, /^ {2}services\.yaml: /m);

  const values: Json = JSON.parse(await repoFile(prometheusOverlay));
  const mount = values.server.extraConfigmapMounts.find(
    (entry: Json) => entry.configMap === "kore-prometheus-rules",
  );
  assert.ok(mount, "the kore-prometheus-rules ConfigMap is mounted");
  const ruleFiles = values.serverFiles["prometheus.yml"].rule_files;
  const files = (
    await readdir(
      join(await findRoot(), "infra/observability/config/files/rules"),
    )
  ).filter((name) => name.endsWith(".yaml"));
  assert.ok(files.includes("services.yaml"));
  for (const file of files) {
    assert.ok(
      ruleFiles.includes(`${mount.mountPath}/${file}`),
      `Prometheus lists ${mount.mountPath}/${file} in rule_files, or the rules never load`,
    );
  }
});

test("kube-state-metrics exports the service label for Deployments and Pods, and nothing else is added to the allowlist", async () => {
  const values: Json = JSON.parse(await repoFile(commonPrometheus));
  assert.deepEqual(values["kube-state-metrics"].metricLabelsAllowlist, [
    "deployments=[app.kubernetes.io/part-of]",
    "pods=[app.kubernetes.io/part-of]",
  ]);
});

test("each evidence signal is recorded once: no record name is defined twice, and the namespace-keyed series and the 5 percent cap exist", async () => {
  const names = recordedNames(await repoFile(ruleFile));
  assert.equal(new Set(names).size, names.length, "record names are unique");
  assert.ok(
    names.includes("kore:error_ratio_cap"),
    "the 5 percent cap is one series",
  );
  assert.ok(names.includes("kore:namespace_error_ratio_5m"));
  assert.ok(names.includes("kore:namespace_requests_increase5m"));
  assert.ok(names.includes("kore:namespace_server_errors_increase5m"));
});

test("the rendered dashboard and alerts hold no raw metric names and read only recorded series that the rule file defines", async () => {
  const rendered = await renderChart(
    "infra/charts/service-observability",
    'services=["shop"]',
  );
  assert.doesNotMatch(
    rendered,
    rawMetric,
    "no raw metric name or rate function",
  );
  const defined = new Set(recordedNames(await repoFile(ruleFile)));
  const read = readNames(rendered);
  assert.ok(read.length > 0, "the dashboard and alerts read recorded series");
  for (const name of read) {
    assert.ok(defined.has(name), `${name} is a recorded series in ${ruleFile}`);
  }
});

test("the Grafana error alert reads the recorded ratio and the cap series, so the five percent limit is typed once", async () => {
  const rendered = await renderChart(
    "infra/charts/service-observability",
    'services=["shop"]',
  );
  assert.match(rendered, /kore:error_ratio_cap/);
  assert.doesNotMatch(
    rendered,
    /0\.05/,
    "the cap number is not typed in the chart",
  );
});
