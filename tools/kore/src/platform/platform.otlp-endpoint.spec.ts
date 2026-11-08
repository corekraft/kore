import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

const collectorValues = "infra/observability/collector/values.yaml";
const endpointFiles = [
  "infra/environments/local/environment.yaml",
  "infra/environments/managed-example/environment.yaml",
  "apps/reference/charts/workload/values.yaml",
  "apps/reference/charts/resources/values.yaml",
];

async function collectorHost(root: string): Promise<string> {
  const values = JSON.parse(
    await readFile(join(root, collectorValues), "utf8"),
  );
  return `${values.fullnameOverride}.observability.svc`;
}

test("every documented OTLP endpoint names the Collector Service that exists", async () => {
  const { root } = await loadRepository("local");
  const host = await collectorHost(root);
  for (const file of endpointFiles) {
    const text = await readFile(join(root, file), "utf8");
    const endpoints = [...text.matchAll(/https?:\/\/([^:/"\s]+):4318/g)].map(
      (match) => match[1],
    );
    assert.ok(endpoints.length > 0, `${file} declares no OTLP endpoint`);
    for (const endpoint of endpoints) {
      assert.equal(endpoint, host, file);
    }
  }
});
