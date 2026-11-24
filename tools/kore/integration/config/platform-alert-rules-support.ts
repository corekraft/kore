import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { findRoot } from "../../src/config/index.js";

// Shared by the platform alert specs (#1619): the chart rendered as helm
// renders it, the Grafana alerting file it holds, and promtool over the rules.

const run = promisify(execFile);

export const chartPath = "infra/observability/config";
export const templateFile = "templates/platform-alert-rules.yaml";
export const configMapName = "kore-platform-alert-rules";
export const fileKey = "platform-alerts.yaml";
export const externalDnsFlag = "external-dns";
export const certificateFlag = "acme-dns01";

export interface Evaluator {
  type: "lt" | "gt";
  params: number[];
}

export interface PlatformAlert {
  uid: string;
  title: string;
  condition: string;
  data: {
    refId: string;
    datasourceUid: string;
    model: {
      refId: string;
      expr?: string;
      conditions?: { evaluator: Evaluator }[];
    };
  }[];
  noDataState: string;
  execErrState: string;
  for: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export interface PlatformGroup {
  orgId: number;
  name: string;
  folder: string;
  interval: string;
  rules: PlatformAlert[];
}

/** The chart rendered with the given --set-json values, as helm template prints it. */
export async function render(
  chart: string,
  ...sets: string[]
): Promise<string> {
  const { stdout } = await run("helm", [
    "template",
    "kore-observability-config",
    chart,
    "--namespace",
    "observability",
    ...sets.flatMap((set) => ["--set-json", set]),
  ]);
  return stdout;
}

/** The chart's absolute path in this checkout. */
export async function chartDir(): Promise<string> {
  return join(await findRoot(), chartPath);
}

/** A copy of the chart without the platform alert template: the chart as main holds it. */
export async function chartWithoutAlerts(chart: string): Promise<string> {
  const copy = await mkdtemp(join(tmpdir(), "kore-observability-config-"));
  await cp(chart, copy, { recursive: true });
  await rm(join(copy, templateFile));
  return copy;
}

/** The both-flags-on render, the rules the spec reads. */
export async function renderWithBothFlags(): Promise<string> {
  return render(
    await chartDir(),
    JSON.stringify({
      features: { [externalDnsFlag]: true, [certificateFlag]: true },
    }),
  );
}

/** The platform alert ConfigMap's rendered document, or undefined when no flag puts it there. */
export function alertDocument(rendered: string): string | undefined {
  return rendered
    .split(/^---$/m)
    .find((document) => document.includes(`name: ${configMapName}`));
}

/** The Grafana alerting file the ConfigMap holds, parsed. */
export function alertFile(rendered: string): {
  apiVersion: number;
  groups: PlatformGroup[];
} {
  const doc = alertDocument(rendered);
  assert.ok(doc, "the platform alert ConfigMap is rendered");
  const marker = `  ${fileKey}: |\n`;
  const body = doc.slice(doc.indexOf(marker) + marker.length);
  const text = body
    .split("\n")
    .map((line) => line.replace(/^ {4}/, ""))
    .join("\n");
  return JSON.parse(text) as { apiVersion: number; groups: PlatformGroup[] };
}

export const allRules = (rendered: string): PlatformAlert[] =>
  alertFile(rendered).groups.flatMap((group) => group.rules);

export const ruleTitles = (rendered: string): string[] =>
  allRules(rendered).map((rule) => rule.title);

export function expressionOf(rule: PlatformAlert): string {
  const query = rule.data.find((d) => d.refId === "A");
  assert.ok(query?.model.expr, `${rule.title} queries an expression`);
  return query.model.expr;
}

export function thresholdOf(rule: PlatformAlert): Evaluator {
  const threshold = rule.data.find((d) => d.refId === "C");
  const evaluator = threshold?.model.conditions?.[0]?.evaluator;
  assert.ok(evaluator, `${rule.title} thresholds its query`);
  return evaluator;
}

/**
 * The Prometheus rule file that tests one rendered Grafana rule: the same
 * expression, with the threshold applied, so promtool evaluates exactly what
 * Grafana renders.
 */
export function prometheusRules(rules: PlatformAlert[]) {
  return {
    groups: [
      {
        name: "kore.platform.rendered",
        rules: rules.map((rule) => {
          const { type, params } = thresholdOf(rule);
          const op = type === "gt" ? ">" : "<";
          return {
            alert: rule.title,
            expr: `(${expressionOf(rule)}) ${op} ${params[0]}`,
            for: rule.for,
            labels: rule.labels,
            annotations: rule.annotations,
          };
        }),
      },
    ],
  };
}

/** Checks the rendered rules with promtool and runs the given unit tests over them. */
export async function runPromtool(
  rules: PlatformAlert[],
  tests: unknown[],
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "kore-platform-alert-rules-"));
  try {
    const rulesPath = join(dir, "platform-alerts.yaml");
    const testPath = join(dir, "platform-alerts.test.yaml");
    await writeFile(rulesPath, JSON.stringify(prometheusRules(rules)));
    await writeFile(
      testPath,
      JSON.stringify({
        rule_files: ["platform-alerts.yaml"],
        evaluation_interval: "1m",
        tests,
      }),
    );
    await run("promtool", ["check", "rules", rulesPath]);
    await run("promtool", ["test", "rules", testPath]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
