import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import { helmTemplateArgs, withAbsoluteChart } from "./helm.js";

function render(repository: Repository): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-config",
  )!;
  return execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { cwd: repository.root, encoding: "utf8" },
  );
}

test("the local overlay publishes the Gateway Service as a NodePort the load balancer maps", async () => {
  const repository = await loadRepository("local");
  const { k3d, gateway } = repository.environment;
  const output = render(repository);
  assert.match(output, /parametersRef:/);
  assert.match(output, /type: NodePort/);
  const mapped = k3d?.ports.find((p) => p.hostPort === gateway.port);
  assert.ok(mapped, "the k3d block maps the Gateway host port");
  assert.match(
    output,
    new RegExp(`port: ${gateway.port}\\s+nodePort: ${mapped.loadBalancerPort}`),
  );
});

test("an overlay that sets no Gateway service leaves the chart's Gateway untouched", async () => {
  const repository = await loadRepository("managed-example");
  const output = render(repository);
  assert.doesNotMatch(output, /parametersRef/);
  assert.doesNotMatch(output, /NodePort/);
});

test("the platform chart stays provider-neutral about k3d", async () => {
  const repository = await loadRepository("local");
  const chart = `${repository.root}/infra/charts/platform-config`;
  for (const file of [
    "values.yaml",
    "templates/gateway.yaml",
    "templates/gateway-service.yaml",
  ]) {
    assert.doesNotMatch(await readFile(`${chart}/${file}`, "utf8"), /k3d/i);
  }
});
