import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0137-the-postgresql-composition-becomes-a-chart-that-takes-database-routes-behind-database-routes.md
// Helpers for the PostgreSQL chart specs: render the chart with helm, and run one
// composition step's Go template against a synthetic observed composite, as
// function-go-templating does.

const run = promisify(execFile);

export const databaseRoutes = [
  "--set",
  "databaseRoutes=true",
  "--set-string",
  "platformDomain=kore.internal",
  "--set-string",
  "organizationId=platform",
  "--set-string",
  "gateway.name=kore-gateway",
  "--set-string",
  "gateway.namespace=kore-system",
];

export async function chart(...set: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "kore-postgresql-api",
    join(root, "infra/apis/postgresql"),
    ...set,
  ]);
  return stdout;
}

/**
 * The rendered documents, each without helm's `# Source:` header and without the
 * blank line helm puts before its `---` separator: the document's own bytes remain.
 */
export function documents(stdout: string): string[] {
  return stdout
    .split(/^---$/m)
    .map((doc) =>
      doc.replace(/^\s*# Source: [^\n]*\n/, "").replace(/\n+$/, "\n"),
    )
    .filter((doc) => doc.trim() !== "");
}

export const kind = (stdout: string, name: string) =>
  documents(stdout).find((doc) => new RegExp(`^kind: ${name}$`, "m").test(doc));

/** The inline Go template of one pipeline step, dedented, as function-go-templating reads it. */
export function inlineTemplate(stdout: string, step: string): string {
  const composition = kind(stdout, "Composition");
  assert.ok(composition, "a Composition is rendered");
  const lines = composition
    .slice(composition.indexOf(`- step: ${step}`))
    .split("\n");
  const start = lines.findIndex((line) => /^\s*template: \|$/.test(line));
  assert.ok(start >= 0, `${step} has an inline template`);
  const keyIndent = /^ */.exec(lines[start] ?? "")![0].length;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && /^ */.exec(line)![0].length <= keyIndent) {
      break;
    }
    body.push(line);
  }
  const indent = Math.min(
    ...body
      .filter((line) => line.trim() !== "")
      .map((line) => /^ */.exec(line)![0].length),
  );
  return body.map((line) => line.slice(indent)).join("\n");
}

/** Runs one step's template against a synthetic observed composite, as the function does. */
export async function renderStep(
  template: string,
  version: number,
  database?: object,
  route?: object,
  serviceClass = "development",
) {
  const directory = await mkdtemp(join(tmpdir(), "kore-postgresql-chart-"));
  try {
    await mkdir(join(directory, "templates"));
    await writeFile(
      join(directory, "Chart.yaml"),
      "apiVersion: v2\nname: composition\nversion: 0.0.0\n",
    );
    await writeFile(
      join(directory, "templates", "step.yaml"),
      `{{- with .Values }}\n${template}\n{{- end }}\n`,
    );
    const observed = {
      composite: {
        resource: {
          metadata: { name: "orders-db", namespace: "orders" },
          spec: {
            retentionPolicy: "Delete",
            compatibilityVersion: version,
            serviceClass,
            storageSize: "5Gi",
            connectionSecretName: "orders-db-conn",
          },
        },
      },
      resources: {
        ...(database ? { database: { resource: { status: database } } } : {}),
        ...(route ? { "database-route": { resource: { status: route } } } : {}),
      },
    };
    const values = join(directory, "values.json");
    await writeFile(values, JSON.stringify({ observed }));
    const { stdout } = await run("helm", [
      "template",
      "composition",
      directory,
      "--values",
      values,
    ]);
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const secretKeys = (doc: string) =>
  doc
    .slice(doc.indexOf("stringData:"))
    .split("\n")
    .slice(1)
    .map((line) => /^ {2}(\w+):/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
