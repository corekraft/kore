import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md

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

test("the service observability chart is flag-gated behind platform-portal, so with the flag off nothing reaches a cluster", async () => {
  for (const name of ["local", "managed-example"]) {
    const repository = await loadRepository(name);
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

test("with no Service registered the chart renders an empty rule file and no dashboard", async () => {
  const rendered = await render();
  assert.match(rulesOf(rendered), /groups: \[\]/);
  assert.equal(rendered.includes("grafana_dashboard"), false);
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

test("each registered Service gets default alerts that pass promtool and carry no routing when no destination is set", async () => {
  const rules = rulesOf(await render('services=["shop"]'));
  assert.match(rules, /alert: ServiceUnavailable/);
  assert.match(rules, /alert: ServiceHighErrorRatio/);
  assert.match(rules, /alert: ServiceRestartLoop/);
  assert.match(rules, /service: shop/);
  assert.match(rules, /enforcement: notify-only/);
  assert.equal(rules.includes("notify:"), false);
  assert.equal(rules.includes("contact_point"), false);
  const dir = await mkdtemp(join(tmpdir(), "service-rules-"));
  const file = join(dir, "services.yaml");
  await writeFile(file, fileBody(rules, "services.yaml"));
  const { stdout } = await run("promtool", ["check", "rules", file]);
  assert.match(stdout, /3 rules found/);
});

test("a configured alert destination is carried as a label, since Grafana's one policy routes every alert to the contact point", async () => {
  const rules = rulesOf(
    await render('services=["shop"]', 'alerts={"destination":"ops-team"}'),
  );
  assert.match(rules, /contact_point: ops-team/);
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
