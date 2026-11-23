import { loadRepository } from "../config/index.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";

// Docs: docs/operations/agentgateway-data-plane-series.md (issue #1514)

type Json = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any

const prometheus = "infra/environments/local/values/prometheus.yaml";
const jobName = "agentgateway-data-plane";
const dataPlaneNamespace = "kore-system";
const dataPlaneGateway = "kore-gateway";
// Unverified against the pinned agentgateway v1.7.0 (issue #1514): the port the
// data plane serves Prometheus metrics on. See the finding for the live query.
const metricsPort = "15020";
const gatewayLabel =
  "__meta_kubernetes_pod_label_gateway_networking_k8s_io_gateway_name";

/** The scrape jobs the chart pastes verbatim under scrape_configs, one per line. */
async function scrapeJobs(path: string): Promise<Json[]> {
  const { root } = await loadRepository("local");
  const values = JSON.parse(await readFile(join(root, path), "utf8"));
  const lines: string[] = values.extraScrapeConfigs.trimEnd().split("\n");
  assert.ok(
    lines.every((line) => line.startsWith("- {")),
    "every extraScrapeConfigs line is a block-sequence item",
  );
  return lines.map((line) => JSON.parse(line.slice(2)));
}

test("Prometheus scrapes the agentgateway data plane through its own job, keeping the Collector jobs", async () => {
  const jobs = await scrapeJobs(prometheus);
  const names = jobs.map((job) => job.job_name);
  assert.ok(names.includes("otel-collector-exporter"));
  assert.ok(names.includes("otel-collector-self"));
  assert.equal(names.filter((name) => name === jobName).length, 1);
  assert.ok(
    !names.includes("kubernetes-pods"),
    "this list never redefines the chart's default kubernetes-pods job",
  );

  const job = jobs.find((entry) => entry.job_name === jobName)!;
  assert.equal(job.scrape_interval, "30s");
  assert.deepEqual(job.kubernetes_sd_configs, [
    { role: "pod", namespaces: { names: [dataPlaneNamespace] } },
  ]);
});

test("the data-plane job keeps only the Gateway's pods on the metrics port, and labels each sample with its pod", async () => {
  const job = (await scrapeJobs(prometheus)).find(
    (entry) => entry.job_name === jobName,
  )!;
  const keeps = job.relabel_configs.filter(
    (rule: Json) => rule.action === "keep",
  );
  assert.deepEqual(keeps, [
    {
      source_labels: [gatewayLabel],
      regex: dataPlaneGateway,
      action: "keep",
    },
    {
      source_labels: ["__meta_kubernetes_pod_container_port_number"],
      regex: metricsPort,
      action: "keep",
    },
  ]);
  const labels = job.relabel_configs.map((rule: Json) => rule.target_label);
  assert.ok(labels.includes("namespace"));
  assert.ok(labels.includes("pod"));
});

test("only the local overlay, where ingress-agentgateway is on, scrapes the data plane", async () => {
  const local = await loadRepository("local");
  assert.equal(local.environment.features?.["ingress-agentgateway"], true);
  assert.ok(
    local.environment.componentValues?.prometheus?.includes(prometheus),
  );

  for (const name of ["vps", "managed-example"]) {
    const other = await loadRepository(name);
    assert.equal(other.environment.features?.["ingress-agentgateway"], false);
    assert.ok(
      !(other.environment.componentValues?.prometheus ?? []).includes(
        prometheus,
      ),
      `${name} does not layer the local Prometheus values`,
    );
  }
});
