// Docs: docs/operations/agentgateway-data-plane-series.md (issue #1514, ADR 0174)
import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { renderChart } from "../../src/testing/index.js";

// Renders the Gateway that platform-config owns, with the data-plane metrics
// flag and the ingress flag stated on and off, and reads its infrastructure
// block. The flag marks the data-plane pods for the chart's pod scrape only
// with agentgateway as the GatewayClass.

const flag = "agentgateway-data-plane-metrics";
const ingressFlag = "ingress-agentgateway";
// The annotations sit under the Gateway's infrastructure block, after its labels
// and their comment lines.
const scrapeAnnotations =
  /^ {2}infrastructure:\n[\s\S]*?^ {4}annotations:\n {6}prometheus\.io\/scrape: "true"\n {6}prometheus\.io\/port: "15020"$/m;

async function renderGateway(
  features: Record<string, boolean>,
): Promise<string> {
  const base = await loadRepository("local");
  const repository: Repository = {
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, ...features },
    },
  };
  const component = repository.catalog.components.find(
    ({ name }) => name === "kore-platform-config",
  );
  assert.ok(component, "kore-platform-config is in the catalog");
  const rendered = await renderChart(repository, component);
  const gateway = rendered
    .split(/^---$/m)
    .find(
      (document) =>
        /^kind: Gateway$/m.test(document) &&
        /^  name: kore-gateway$/m.test(document),
    );
  assert.ok(gateway, "the platform Gateway is rendered");
  return gateway;
}

test("with the flag on and agentgateway as the class, the data-plane pods are annotated for the Prometheus pod scrape", async () => {
  const gateway = await renderGateway({ [flag]: true, [ingressFlag]: true });
  assert.match(gateway, /gatewayClassName: agentgateway/);
  assert.match(gateway, scrapeAnnotations);
});

test("with the flag off the Gateway carries no scrape annotation, so its rendered output is as before", async () => {
  const gateway = await renderGateway({ [flag]: false, [ingressFlag]: true });
  assert.match(gateway, /gatewayClassName: agentgateway/);
  assert.doesNotMatch(gateway, /prometheus\.io\//);
});

test("with the flag on but the Istio class, the Gateway gets no scrape annotation", async () => {
  const gateway = await renderGateway({ [flag]: true, [ingressFlag]: false });
  assert.match(gateway, /gatewayClassName: istio/);
  assert.doesNotMatch(gateway, /prometheus\.io\//);
});
