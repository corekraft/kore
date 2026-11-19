import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

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

function withSharedGateway(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "platform-shared-gateway": on,
      },
    },
  };
}

// Flag off: the Service keeps the listener port. Flag on: the Service exposes
// the standard port 443 and reaches the unchanged listener through targetPort.
test.each([false, true])(
  "the local overlay publishes the Gateway Service as a NodePort the load balancer maps, with platform-shared-gateway %s",
  async (on) => {
    const repository = withSharedGateway(await loadRepository("local"), on);
    const { k3d, gateway } = repository.environment;
    const output = render(repository);
    assert.match(output, /parametersRef:/);
    assert.match(output, /type: NodePort/);
    const mapped = k3d?.ports.find((p) => p.hostPort === gateway.port);
    assert.ok(mapped, "the k3d block maps the Gateway host port");
    const servicePort = on ? 443 : gateway.port;
    const target = on ? `\\s+targetPort: ${gateway.port}` : "";
    assert.match(
      output,
      new RegExp(
        `port: ${servicePort}${target}\\s+nodePort: ${mapped.loadBalancerPort}`,
      ),
    );
    assert.equal(/targetPort/.test(output), on);
  },
);

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
