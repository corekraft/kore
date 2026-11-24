import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot, loadServiceRegistrations } from "../../src/config/index.js";
import { dir, fixture, record, release } from "./app-records-support.js";

// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md
// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md

// The service list the chart is handed follows the record move (ADR 0166): the
// legacy registrations and this environment's spec files, validated by kore validate
// and rendered by the real chart. The chart itself reads no file.

const run = promisify(execFile);

/** The chart rendered with the given service names, as kore hands them over. */
async function renderServices(names: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-service-observability",
    join(root, "infra/charts/service-observability"),
    "--namespace",
    "observability",
    "--set-json",
    `services=${JSON.stringify(names)}`,
  ]);
  return stdout;
}

/** The dashboard ConfigMaps and the Grafana alert group names of a rendered chart. */
function renderedCounts(rendered: string): {
  dashboards: number;
  groups: string[];
} {
  return {
    dashboards: rendered.split('grafana_dashboard: "1"').length - 1,
    groups: [...rendered.matchAll(/"name": "(kore\.service\.[a-z0-9-]+)"/g)]
      .map((match) => match[1] ?? "")
      .sort(),
  };
}

/** A legacy registration file under infra/services, as the repository held them before the record move. */
const legacy = (name: string): string =>
  JSON.stringify({
    apiVersion: "platform.kore.dev/v1alpha1",
    kind: "Service",
    metadata: { name },
    spec: { organization: "platform", environments: ["local"] },
  });

test("the Services the legacy registrations and this environment's records name each render one dashboard and one alert group, with the records validated", async () => {
  const repo = await fixture({
    [`${dir}/blog.json`]: record("blog"),
    [`${dir}/blog.release.json`]: release("blog"),
    [`${dir}/shop.json`]: record("shop"),
    "infra/services/tea.yaml": legacy("tea"),
  });
  try {
    assert.deepEqual((await repo.check()).errors, []);
    const names = await loadServiceRegistrations(repo.root, "local");
    assert.deepEqual(names, ["blog", "shop", "tea"]);
    const counts = renderedCounts(await renderServices(names));
    assert.equal(counts.dashboards, 3);
    assert.deepEqual(counts.groups, [
      "kore.service.blog",
      "kore.service.shop",
      "kore.service.tea",
    ]);
  } finally {
    await repo.remove();
  }
});

test("a Service in both the legacy registrations and this environment's records renders once, and kore validate still refuses it", async () => {
  const repo = await fixture({
    [`${dir}/shop.json`]: record("shop"),
    "infra/services/shop.yaml": legacy("shop"),
  });
  try {
    const report = await repo.check();
    assert.ok(
      report.errors.some((error) =>
        error.includes(
          "both declare the service shop: a service name is unique across the cluster",
        ),
      ),
      "kore validate refuses the name in both places",
    );
    const names = await loadServiceRegistrations(repo.root, "local");
    assert.deepEqual(names, ["shop"]);
    const counts = renderedCounts(await renderServices(names));
    assert.equal(counts.dashboards, 1);
    assert.deepEqual(counts.groups, ["kore.service.shop"]);
  } finally {
    await repo.remove();
  }
});
