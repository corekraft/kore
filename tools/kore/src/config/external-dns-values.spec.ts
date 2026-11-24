// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { findRoot } from "./config.js";
import { componentGatedOff } from "./features.js";
import type { Catalog, Component } from "./types.js";

const valuesPath = "infra/environments/common/values/external-dns.yaml";

/** The external-dns values file, parsed: it is JSON-compatible YAML (ADR 0168 keeps config JSON-compatible). */
async function externalDnsValues(): Promise<Record<string, unknown>> {
  const text = await readFile(join(await findRoot(), valuesPath), "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

/** The pod annotations Helm receives for external-dns: none when its component is gated off, else the values file's. */
async function renderedPodAnnotations(
  features: Record<string, boolean>,
): Promise<Record<string, string> | undefined> {
  const component = await externalDnsComponent();
  if (componentGatedOff({ features }, component)) {
    return undefined;
  }
  const values = await externalDnsValues();
  return values.podAnnotations as Record<string, string> | undefined;
}

async function externalDnsComponent(): Promise<Component> {
  const catalog = JSON.parse(
    await readFile(
      join(await findRoot(), "infra/catalog/components.yaml"),
      "utf8",
    ),
  ) as Catalog;
  const component = catalog.components.find(
    ({ name }) => name === "external-dns",
  );
  if (component === undefined) {
    throw new Error("the catalog has no external-dns component");
  }
  return component;
}

test("with the external-dns flag on, the values file carries the Prometheus scrape annotations on the pod", async () => {
  expect(await renderedPodAnnotations({ "external-dns": true })).toEqual({
    "prometheus.io/scrape": "true",
    "prometheus.io/port": "7979",
  });
});

test("the scrape port 7979 is the metrics port the pinned chart 1.24.0 serves (service.port and the http container port)", async () => {
  const annotations = await renderedPodAnnotations({ "external-dns": true });
  expect(annotations?.["prometheus.io/port"]).toBe("7979");
});

test("with the external-dns flag off, no pod annotation is rendered, so the scrape annotation is absent", async () => {
  expect(
    await renderedPodAnnotations({ "external-dns": false }),
  ).toBeUndefined();
  expect(await renderedPodAnnotations({})).toBeUndefined();
});

test("the values file reaches Helm only through the external-dns component, which its featureFlag gates", async () => {
  const component = await externalDnsComponent();
  expect(component.featureFlag).toBe("external-dns");
  expect(component.values).toContain(valuesPath);
});

test("no ServiceMonitor is rendered: the values file sets none and the scrape is the pod annotation", async () => {
  const values = await externalDnsValues();
  expect(values).not.toHaveProperty("serviceMonitor");
  expect(JSON.stringify(values)).not.toMatch(/serviceMonitor/i);
});
