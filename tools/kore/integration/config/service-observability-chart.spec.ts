import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  enabledComponents,
  findRoot,
  loadRepository,
  orderedComponents,
  platformPortalFlag,
  validateRepository,
} from "../../src/config/index.js";
import { withGatewayFlagsOff } from "../../src/testing/index.js";

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
// Docs: docs/decisions/0177-service-alert-rules-are-grafana-managed-rules-over-the-prometheus-datasource.md

const run = promisify(execFile);
const chartPath = "infra/charts/service-observability";

async function render(...sets: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-service-observability",
    join(root, chartPath),
    "--namespace",
    "observability",
    ...sets.flatMap((set) => ["--set-json", set]),
  ]);
  return stdout;
}

const documents = (rendered: string): string[] =>
  rendered.split(/^---$/m).filter((part) => /^kind:/m.test(part));

const rulesOf = (rendered: string): string => {
  const doc = documents(rendered).find((d) =>
    d.includes("name: kore-service-rules"),
  );
  assert.ok(doc, "the rules ConfigMap");
  return doc;
};

const fileBody = (doc: string, key: string): string => {
  const marker = `  ${key}: |\n`;
  const body = doc.slice(doc.indexOf(marker) + marker.length);
  return body
    .split("\n")
    .map((line) => line.replace(/^ {4}/, ""))
    .join("\n");
};

/** The Grafana alerting provisioning file the rules ConfigMap holds, parsed. */
const alertFileOf = (rendered: string): unknown =>
  JSON.parse(fileBody(rulesOf(rendered), "services.yaml"));

/** The uid the chart derives for a Service's alert: stable, and forty characters at most. */
const alertUid = (service: string, alert: string): string =>
  "kore-" +
  createHash("sha256").update(`${service}/${alert}`).digest("hex").slice(0, 32);

test("the service observability chart is flag-gated behind platform-portal, so with the flag off nothing reaches a cluster", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = withGatewayFlagsOff(await loadRepository(name));
    await validateRepository(repository);
    const component = repository.catalog.components.find(
      (c) => c.name === "kore-service-observability",
    );
    assert.equal(component?.featureFlag, platformPortalFlag);
    assert.equal(component?.kind, "local-chart");
    assert.equal(component?.namespace, "observability");
    assert.deepEqual(component?.ownsCRDs, []);
    assert.deepEqual(component?.readiness, ["configmap/kore-service-rules"]);
    const installed = enabledComponents(repository).map((c) => c.name);
    assert.equal(installed.includes("kore-service-observability"), false);
    const order = orderedComponents(repository.catalog).map((c) => c.name);
    assert.ok(
      order.indexOf("grafana") < order.indexOf("kore-service-observability"),
    );
  }
});

test("with no Service registered the chart renders an alert file with no group and no dashboard", async () => {
  const rendered = await render();
  assert.deepEqual(alertFileOf(rendered), { apiVersion: 1, groups: [] });
  assert.equal(rendered.includes("grafana_dashboard"), false);
});

test("the alert ConfigMap is labelled for Grafana's alerting sidecar, so Grafana loads it and no Prometheus rule file", async () => {
  const rules = rulesOf(await render('services=["shop"]'));
  assert.match(rules, /grafana_alert: "1"/);
  assert.equal(rules.includes("kind: PrometheusRule"), false);
  assert.equal(rules.includes("alerting_rules"), false);
});

test("each registered Service gets its own dashboard ConfigMap labelled for Grafana discovery, scoped to its namespace", async () => {
  const rendered = await render('services=["shop","blog"]');
  const dashboards = documents(rendered).filter((d) =>
    d.includes("grafana_dashboard"),
  );
  assert.equal(dashboards.length, 2);
  const shop = dashboards.find((d) => d.includes("kore-dashboard-shop"));
  assert.ok(shop);
  assert.match(shop, /grafana_dashboard: "1"/);
  assert.match(shop, /platform\.kore\.dev\/service: shop/);
  assert.match(shop, /shop--local/);
  assert.equal(shop.includes("blog--local"), false);
  assert.equal(shop.includes("__"), false, "no placeholder left");
  const dashboard = JSON.parse(fileBody(shop, "shop.json")) as {
    uid: string;
    title: string;
  };
  assert.equal(dashboard.uid, "kore-service-shop");
  assert.equal(dashboard.title, "Service shop");
});

test("each registered Service gets one Grafana-managed alert group over the Prometheus datasource, with its three notify-only rules", async () => {
  const file = alertFileOf(await render('services=["shop"]'));
  const group = {
    orgId: 1,
    name: "kore.service.shop",
    folder: "Kore",
    interval: "1m",
    rules: [
      {
        uid: alertUid("shop", "ServiceUnavailable"),
        title: "ServiceUnavailable",
        condition: "C",
        data: [
          {
            refId: "A",
            relativeTimeRange: { from: 600, to: 0 },
            datasourceUid: "prometheus",
            model: {
              refId: "A",
              expr: 'sum(kube_deployment_status_replicas_available{namespace="shop--local"})',
              instant: true,
              intervalMs: 1000,
              maxDataPoints: 43200,
            },
          },
          {
            refId: "C",
            relativeTimeRange: { from: 0, to: 0 },
            datasourceUid: "__expr__",
            model: {
              refId: "C",
              type: "threshold",
              expression: "A",
              conditions: [{ evaluator: { type: "lt", params: [1] } }],
            },
          },
        ],
        noDataState: "OK",
        execErrState: "Error",
        for: "5m",
        labels: {
          severity: "critical",
          service: "shop",
          enforcement: "notify-only",
        },
        annotations: { summary: "Service shop has no available replica" },
      },
      {
        uid: alertUid("shop", "ServiceHighErrorRatio"),
        title: "ServiceHighErrorRatio",
        condition: "C",
        data: [
          {
            refId: "A",
            relativeTimeRange: { from: 600, to: 0 },
            datasourceUid: "prometheus",
            model: {
              refId: "A",
              expr: 'sum(rate(istio_requests_total{destination_service_namespace="shop--local",response_code=~"5.."}[5m])) / sum(rate(istio_requests_total{destination_service_namespace="shop--local"}[5m]))',
              instant: true,
              intervalMs: 1000,
              maxDataPoints: 43200,
            },
          },
          {
            refId: "C",
            relativeTimeRange: { from: 0, to: 0 },
            datasourceUid: "__expr__",
            model: {
              refId: "C",
              type: "threshold",
              expression: "A",
              conditions: [{ evaluator: { type: "gt", params: [0.05] } }],
            },
          },
        ],
        noDataState: "OK",
        execErrState: "Error",
        for: "10m",
        labels: {
          severity: "warning",
          service: "shop",
          enforcement: "notify-only",
        },
        annotations: {
          summary:
            "Service shop answers more than 5 percent of requests with a server error",
        },
      },
      {
        uid: alertUid("shop", "ServiceRestartLoop"),
        title: "ServiceRestartLoop",
        condition: "C",
        data: [
          {
            refId: "A",
            relativeTimeRange: { from: 600, to: 0 },
            datasourceUid: "prometheus",
            model: {
              refId: "A",
              expr: 'sum(increase(kube_pod_container_status_restarts_total{namespace="shop--local"}[15m]))',
              instant: true,
              intervalMs: 1000,
              maxDataPoints: 43200,
            },
          },
          {
            refId: "C",
            relativeTimeRange: { from: 0, to: 0 },
            datasourceUid: "__expr__",
            model: {
              refId: "C",
              type: "threshold",
              expression: "A",
              conditions: [{ evaluator: { type: "gt", params: [3] } }],
            },
          },
        ],
        noDataState: "OK",
        execErrState: "Error",
        for: "5m",
        labels: {
          severity: "warning",
          service: "shop",
          enforcement: "notify-only",
        },
        annotations: {
          summary:
            "Containers of service shop restarted more than 3 times in 15 minutes",
        },
      },
    ],
  };
  assert.deepEqual(file, { apiVersion: 1, groups: [group] });
});

test("a configured alert destination is carried as a contact_point label on every rule, since Grafana's one policy routes every alert to the contact point", async () => {
  const file = alertFileOf(
    await render('services=["shop"]', 'alerts={"destination":"ops-team"}'),
  ) as { groups: { rules: { labels: Record<string, string> }[] }[] };
  const labels = file.groups[0]?.rules.map((rule) => rule.labels);
  assert.deepEqual(labels, [
    {
      severity: "critical",
      service: "shop",
      enforcement: "notify-only",
      contact_point: "ops-team",
    },
    {
      severity: "warning",
      service: "shop",
      enforcement: "notify-only",
      contact_point: "ops-team",
    },
    {
      severity: "warning",
      service: "shop",
      enforcement: "notify-only",
      contact_point: "ops-team",
    },
  ]);
});

test("the chart refuses a Service name that is not a single DNS label", async () => {
  await assert.rejects(render('services=["Bad_Name"]'));
  await assert.rejects(render('services=["a--b"]'));
});

test("the chart creates no Secret, and the alert destination is unset in the chart values", async () => {
  const root = await findRoot();
  assert.equal(/kind: Secret\b/.test(await render('services=["shop"]')), false);
  const values = await readFile(join(root, chartPath, "values.yaml"), "utf8");
  assert.equal(/^\s*destination:/m.test(values), false);
});
