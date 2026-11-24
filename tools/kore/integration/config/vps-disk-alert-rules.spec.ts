import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0114-give-the-platform-organization-default-dashboards-notify-only-alerts-and-default-retention.md
// Docs: docs/decisions/0177-service-alert-rules-are-grafana-managed-rules-over-the-prometheus-datasource.md
// Issue: #1516 (node disk and volume fill, notify-only, and the free-space series for the activation floor)

const run = promisify(execFile);

type Json = Record<string, any>; // oxlint-disable-line typescript/no-explicit-any

async function renderChart(...sets: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-test",
    join(root, "infra/observability/config"),
    "--namespace",
    "observability",
    ...sets.flatMap((set) => ["--set-json", set]),
  ]);
  return stdout;
}

/** The disk rule file the ConfigMap kore-prometheus-disk-rules carries, parsed from its JSON block. */
function diskRuleFile(rendered: string): Json {
  const lines = rendered
    .slice(rendered.indexOf("name: kore-prometheus-disk-rules"))
    .split("\n");
  const header = lines.indexOf("  disk.yaml: |");
  assert.notEqual(header, -1, "the ConfigMap carries disk.yaml");
  const body: string[] = [];
  for (const line of lines.slice(header + 1)) {
    if (line !== "" && !line.startsWith("    ")) {
      break;
    }
    body.push(line.slice(4));
  }
  return JSON.parse(body.join("\n"));
}

const rulesNamed = (file: Json, kind: "alert" | "record") =>
  (file["groups"] as Json[]).flatMap((group) =>
    (group["rules"] as Json[]).filter((rule) => rule[kind] !== undefined),
  );

test("the disk rule file holds both notify-only alerts, and drops neither", async () => {
  const file = diskRuleFile(await renderChart());
  const alerts = rulesNamed(file, "alert");
  const volume = alerts.find((rule) => rule["alert"] === "KoreVolumeFillHigh");
  const node = alerts.find(
    (rule) => rule["alert"] === "KoreNodeFilesystemCritical",
  );
  assert.ok(volume, "KoreVolumeFillHigh is rendered");
  assert.ok(node, "KoreNodeFilesystemCritical is rendered");
  assert.equal(volume["labels"]["enforcement"], "notify-only");
  assert.equal(node["labels"]["enforcement"], "notify-only");
});

test("the disk alert thresholds are chart values: 85 percent volume fill and 90 percent node filesystem", async () => {
  const file = diskRuleFile(await renderChart());
  const expr = (name: string) =>
    rulesNamed(file, "alert").find((rule) => rule["alert"] === name)?.["expr"];
  assert.equal(expr("KoreVolumeFillHigh"), "kore:volume_fill_ratio > 0.85");
  assert.equal(
    expr("KoreNodeFilesystemCritical"),
    "1 - kore:node_filesystem_free_ratio > 0.9",
  );
});

test("moving a threshold value moves the alert, so the number is never a literal in the rule", async () => {
  const file = diskRuleFile(
    await renderChart(
      "disk.volumeFillPercent=70",
      "disk.nodeFilesystemCriticalPercent=80",
    ),
  );
  const expr = (name: string) =>
    rulesNamed(file, "alert").find((rule) => rule["alert"] === name)?.["expr"];
  assert.equal(expr("KoreVolumeFillHigh"), "kore:volume_fill_ratio > 0.7");
  assert.equal(
    expr("KoreNodeFilesystemCritical"),
    "1 - kore:node_filesystem_free_ratio > 0.8",
  );
});

test("the free-space series the activation floor reads is recorded from cAdvisor's root filesystem, and the volume fill from kubelet volume stats", async () => {
  const file = diskRuleFile(await renderChart());
  const records = new Map(
    rulesNamed(file, "record").map((rule) => [rule["record"], rule["expr"]]),
  );
  const free = records.get("kore:node_filesystem_free_ratio");
  assert.ok(free, "kore:node_filesystem_free_ratio is recorded");
  assert.match(free, /container_fs_usage_bytes\{id="\/"/);
  assert.match(free, /container_fs_limit_bytes\{id="\/"/);
  assert.match(free, /^min by \(instance\)/);
  const fill = records.get("kore:volume_fill_ratio");
  assert.ok(fill, "kore:volume_fill_ratio is recorded");
  assert.match(fill, /kubelet_volume_stats_used_bytes/);
  assert.match(fill, /kubelet_volume_stats_capacity_bytes/);
});

test("the disk rules read only recorded series, and the alerts name no raw metric", async () => {
  const file = diskRuleFile(await renderChart());
  const alerts = rulesNamed(file, "alert");
  for (const rule of alerts) {
    assert.doesNotMatch(
      rule["expr"],
      /container_|kubelet_/,
      `${rule["alert"]} reads a recorded series`,
    );
  }
});
