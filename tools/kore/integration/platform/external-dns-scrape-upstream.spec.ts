import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../../src/config/index.js";
import { renderChart, yamlDocuments } from "../../src/testing/index.js";

// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
// Issue: #2027

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at a path of object keys, or undefined where the path breaks. */
function at(value: unknown, ...path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) => (isRecord(current) ? current[key] : undefined),
    value,
  );
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function ofKind(documents: unknown[], kind: string): unknown[] {
  return documents.filter((document) => at(document, "kind") === kind);
}

// Opt-in: it pulls the pinned external-dns chart, and fast tests run offline
// (AGENTS.md). Run with `npm run test:upstream-charts` when bumping the chart.
test.runIf(process.env["KORE_CHECK_UPSTREAM_CHARTS"] === "1")(
  "the pinned external-dns chart scrapes the pod on the port it serves metrics on, with no ServiceMonitor",
  async () => {
    const repository = await loadRepository("vps");
    const component = repository.catalog.components.find(
      ({ name }) => name === "external-dns",
    );
    assert.ok(component, "the catalog has an external-dns component");
    const documents = await yamlDocuments(
      await renderChart(repository, component),
    );

    const [deployment] = ofKind(documents, "Deployment");
    const annotations = at(
      deployment,
      "spec",
      "template",
      "metadata",
      "annotations",
    );
    assert.equal(at(annotations, "prometheus.io/scrape"), "true");

    const containerPort = records(
      at(deployment, "spec", "template", "spec", "containers"),
    )
      .flatMap((container) => records(container["ports"]))
      .find((port) => port["name"] === "http")?.["containerPort"];
    const servicePort = records(
      at(ofKind(documents, "Service")[0], "spec", "ports"),
    ).find((port) => port["name"] === "http")?.["port"];
    assert.equal(
      typeof containerPort,
      "number",
      "the chart names an http port",
    );
    assert.equal(at(annotations, "prometheus.io/port"), String(containerPort));
    assert.equal(servicePort, containerPort);

    assert.deepEqual(ofKind(documents, "ServiceMonitor"), []);
  },
  120_000,
);
