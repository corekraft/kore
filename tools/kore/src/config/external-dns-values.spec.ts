// Docs: docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { findRoot } from "./config.js";
import { componentGatedOff } from "./features.js";

// The scrape port is checked against the pinned chart's real metrics port in
// integration/platform/external-dns-scrape-upstream.spec.ts (opt-in, it pulls the chart).

const valuesPath = "infra/environments/common/values/external-dns.yaml";

type GatedComponent = { featureFlag?: string; values: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isGatedComponent(value: unknown): value is GatedComponent {
  return (
    isRecord(value) &&
    (value["featureFlag"] === undefined ||
      typeof value["featureFlag"] === "string") &&
    Array.isArray(value["values"]) &&
    value["values"].every((path) => typeof path === "string")
  );
}

async function readRepositoryJson(path: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(
    await readFile(join(await findRoot(), path), "utf8"),
  );
  return parsed;
}

/** The external-dns values file, parsed: config stays JSON-compatible YAML (AGENTS.md). */
async function externalDnsValues(): Promise<Record<string, unknown>> {
  const values = await readRepositoryJson(valuesPath);
  if (!isRecord(values)) {
    throw new Error(`${valuesPath} is not an object`);
  }
  return values;
}

async function externalDnsComponent(): Promise<GatedComponent> {
  const catalog = await readRepositoryJson("infra/catalog/components.yaml");
  const components = isRecord(catalog) ? catalog["components"] : undefined;
  const component = Array.isArray(components)
    ? components.find(
        (entry) => isRecord(entry) && entry["name"] === "external-dns",
      )
    : undefined;
  if (!isGatedComponent(component)) {
    throw new Error("the catalog has no external-dns component with values");
  }
  return component;
}

/** The pod annotations Helm receives for external-dns: none when its component is gated off, else the values file's. */
async function renderedPodAnnotations(
  features: Record<string, boolean>,
): Promise<Record<string, string> | undefined> {
  const component = await externalDnsComponent();
  if (componentGatedOff({ features }, component)) {
    return undefined;
  }
  const annotations = (await externalDnsValues())["podAnnotations"];
  if (annotations !== undefined && !isStringRecord(annotations)) {
    throw new Error(`${valuesPath} podAnnotations are not string pairs`);
  }
  return annotations;
}

test("with the external-dns flag on, the values file carries the Prometheus scrape annotation and port 7979 on the pod", async () => {
  expect(await renderedPodAnnotations({ "external-dns": true })).toEqual({
    "prometheus.io/scrape": "true",
    "prometheus.io/port": "7979",
  });
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
