import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { findRoot } from "../../src/config/index.js";

// Shared by the suborg render specs: an offline render of the platform-apis chart's
// Organization and Service compositions. function-go-templating needs the Crossplane
// function runtime, so the inline Go templates are rendered with `helm template`, which
// uses the same engine, against a synthetic observed composite (ADR 0165, issue 1552).

export const run = promisify(execFile);
export const root = await findRoot();
export const chart = join(root, "infra/charts/platform-apis");

/** The chart rendered with the given extra Helm arguments, as kore passes them. */
export function render(...extra: string[]): string {
  return execFileSync(
    "helm",
    [
      "template",
      "kore-platform-apis",
      chart,
      "--set-string",
      "platformDomain=kore.internal",
      ...extra,
    ],
    { encoding: "utf8" },
  );
}

/**
 * The flag on, with the platform's shared Gateway on or off. The cluster's service
 * range is passed too: the suborg policies exclude it from open internet egress (ADR
 * 0165, issue 1552), and the chart refuses to render without it.
 */
export function suborgOn(sharedGateway: boolean): string[] {
  return [
    "--set",
    "features.suborg-tenancy=true",
    "--set",
    `features.platform-shared-gateway=${sharedGateway}`,
    "--set-string",
    "suborgNetwork.serviceCidr=10.96.0.0/12",
  ];
}

/** The rendered Composition document with the given name. */
export function composition(rendered: string, name: string): string {
  const found = rendered
    .split(/^---$/m)
    .find((document) => new RegExp(`^  name: ${name}$`, "m").test(document));
  assert.ok(found, `the chart renders the ${name} Composition`);
  return found;
}

/** The inline Go template of one pipeline step, as Helm rendered it into the Composition. */
export function stepTemplate(document: string, step: string): string {
  const lines = document.split("\n");
  const start = lines.findIndex((line) => line === `    - step: ${step}`);
  assert.notEqual(start, -1, `the Composition has a ${step} step`);
  const key = lines.findIndex(
    (line, index) => index > start && /^ +template: \|$/.test(line),
  );
  const keyIndent = lines[key]!.search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(key + 1)) {
    if (line !== "" && line.search(/\S/) <= keyIndent) {
      break;
    }
    body.push(line);
  }
  const indent = body.find((line) => line !== "")!.search(/\S/);
  return body.map((line) => line.slice(indent)).join("\n");
}

/** The Kubernetes objects a step renders for an observed composite, through a temporary chart. */
export async function renderStep(
  template: string,
  resource: Record<string, unknown>,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "kore-suborg-composition-"));
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
    const values = join(directory, "values.json");
    await writeFile(
      values,
      JSON.stringify({ observed: { composite: { resource } } }),
    );
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

/** The documents of a render, each as one string. */
export function documents(rendered: string): string[] {
  return rendered
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document !== "");
}

/** The object of a kind in a render, or undefined. */
export function ofKind(rendered: string, kind: string): string | undefined {
  return documents(rendered).find((document) =>
    new RegExp(`^kind: ${kind}$`, "m").test(document),
  );
}

/** The key-value pairs under one mapping key, such as labels, at the given indent. */
export function mapping(document: string, key: string): Record<string, string> {
  const lines = document.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  assert.notEqual(start, -1, `the object has ${key}`);
  const indent = lines[start]!.search(/\S/);
  const pairs: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      continue;
    }
    if (line.search(/\S/) <= indent) {
      break;
    }
    const match = /^\s+([^:]+): (.*)$/.exec(line);
    assert.ok(match, `a key and a value on ${line}`);
    pairs[match[1]!] = match[2]!.replace(/^"(.*)"$/, "$1");
  }
  return pairs;
}

export const suborg = {
  metadata: { name: "api" },
  spec: {
    tenant: "platform",
    parent: "platform",
    quota: {
      requests: { cpu: "4", memory: "8Gi" },
      pods: 20,
      storage: "100Gi",
    },
  },
};
