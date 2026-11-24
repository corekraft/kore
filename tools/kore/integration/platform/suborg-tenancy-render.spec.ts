import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot, loadRepository } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md
// Offline render of the Organization and Service compositions. function-go-templating
// needs the Crossplane function runtime, so the inline Go templates are rendered with
// `helm template`, which uses the same engine, against a synthetic observed composite.

const run = promisify(execFile);
const root = await findRoot();
const chart = join(root, "infra/charts/platform-apis");

/** The chart rendered with the given extra Helm arguments, as kore passes them. */
function render(...extra: string[]): string {
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

/** The flag on, with the platform's shared Gateway on or off. */
function suborgOn(sharedGateway: boolean): string[] {
  return [
    "--set",
    "features.suborg-tenancy=true",
    "--set",
    `features.platform-shared-gateway=${sharedGateway}`,
  ];
}

/** The rendered Composition document with the given name. */
function composition(rendered: string, name: string): string {
  const found = rendered
    .split(/^---$/m)
    .find((document) => new RegExp(`^  name: ${name}$`, "m").test(document));
  assert.ok(found, `the chart renders the ${name} Composition`);
  return found;
}

/** The inline Go template of one pipeline step, as Helm rendered it into the Composition. */
function stepTemplate(document: string, step: string): string {
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
async function renderStep(
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
function documents(rendered: string): string[] {
  return rendered
    .split(/^---$/m)
    .map((document) => document.trim())
    .filter((document) => document !== "");
}

/** The object of a kind in a render, or undefined. */
function ofKind(rendered: string, kind: string): string | undefined {
  return documents(rendered).find((document) =>
    new RegExp(`^kind: ${kind}$`, "m").test(document),
  );
}

/** The key-value pairs under one mapping key, such as labels, at the given indent. */
function mapping(document: string, key: string): Record<string, string> {
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

const suborg = {
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

test("with suborg-tenancy off the platform-apis render equals the checked-in golden (main plus the additive Service XRD sizing fields)", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-apis",
  )!;
  const rendered = execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { cwd: repository.root, encoding: "utf8" },
  );
  assert.equal(
    rendered,
    await readFile(
      join(root, "tools/kore/src/platform/fixtures/platform-apis.local.yaml"),
      "utf8",
    ),
  );
  assert.doesNotMatch(
    rendered,
    /compose-suborg-namespace/,
    "with suborg-tenancy off no suborg namespace step is rendered",
  );
  assert.equal(
    render("--set", "features.suborg-tenancy=false"),
    render(),
    "an explicit false renders exactly as an absent flag",
  );
});

test("with suborg-tenancy absent the Organization composition has no suborg namespace step", () => {
  const organization = composition(render(), "organization-local");
  assert.doesNotMatch(organization, /compose-suborg-namespace/);
});

test("with suborg-tenancy on the Organization composition has one step that composes the suborg's namespace", () => {
  const organization = composition(
    render(...suborgOn(false)),
    "organization-local",
  );
  assert.match(organization, /- step: compose-suborg-namespace/);
  assert.match(organization, /- step: mark-ready/);
});

test("with suborg-tenancy on a suborg renders exactly its namespace, ResourceQuota and LimitRange, and nothing else", async () => {
  const step = stepTemplate(
    composition(render(...suborgOn(false)), "organization-local"),
    "compose-suborg-namespace",
  );
  const rendered = await renderStep(step, suborg);
  assert.deepEqual(
    documents(rendered).map((document) => /^kind: (\w+)$/m.exec(document)?.[1]),
    ["Namespace", "ResourceQuota", "LimitRange"],
  );
});

test("the suborg namespace is named exactly like the suborg and carries the labels ADR 0165 lists", async () => {
  const step = stepTemplate(
    composition(render(...suborgOn(false)), "organization-local"),
    "compose-suborg-namespace",
  );
  const rendered = await renderStep(step, suborg);
  const namespace = ofKind(rendered, "Namespace")!;
  assert.match(namespace, /^metadata:\n  name: api$/m);
  assert.deepEqual(mapping(namespace, "labels"), {
    "platform.kore.dev/tenant": "platform",
    "platform.kore.dev/organization": "api",
    "pod-security.kubernetes.io/enforce": "restricted",
    "istio.io/dataplane-mode": "ambient",
    "policy.sigstore.dev/include": "true",
  });
});

test("the shared-gateway label is set on the suborg namespace only while platform-shared-gateway is on", async () => {
  const on = await renderStep(
    stepTemplate(
      composition(render(...suborgOn(true)), "organization-local"),
      "compose-suborg-namespace",
    ),
    suborg,
  );
  assert.equal(
    mapping(ofKind(on, "Namespace")!, "labels")[
      "platform.kore.dev/shared-gateway"
    ],
    "true",
  );
  const off = await renderStep(
    stepTemplate(
      composition(render(...suborgOn(false)), "organization-local"),
      "compose-suborg-namespace",
    ),
    suborg,
  );
  assert.equal(
    mapping(ofKind(off, "Namespace")!, "labels")[
      "platform.kore.dev/shared-gateway"
    ],
    undefined,
  );
});

test("the suborg's ResourceQuota and LimitRange are derived from its quota, with no default", async () => {
  const step = stepTemplate(
    composition(render(...suborgOn(false)), "organization-local"),
    "compose-suborg-namespace",
  );
  const rendered = await renderStep(step, suborg);
  const quota = ofKind(rendered, "ResourceQuota")!;
  assert.match(quota, /^  namespace: api$/m);
  assert.deepEqual(mapping(quota, "hard"), {
    "requests.cpu": "4",
    "requests.memory": "8Gi",
    pods: "20",
    "requests.storage": "100Gi",
  });
  const limits = ofKind(rendered, "LimitRange")!;
  assert.match(limits, /^  namespace: api$/m);
  assert.match(limits, /type: Container/);
  assert.match(limits, /type: PersistentVolumeClaim/);
  assert.doesNotMatch(limits, /default/);
  assert.match(limits, /^\s+cpu: "4"$/m);
  assert.match(limits, /^\s+memory: "8Gi"$/m);
  assert.match(limits, /^\s+storage: "100Gi"$/m);
});

test("a composite with no parent, the platform tenant root, renders no namespace", async () => {
  const step = stepTemplate(
    composition(render(...suborgOn(false)), "organization-local"),
    "compose-suborg-namespace",
  );
  const rendered = await renderStep(step, {
    metadata: { name: "platform" },
    spec: { tenant: "platform" },
  });
  assert.equal(ofKind(rendered, "Namespace"), undefined);
});

test("with suborg-tenancy on the Service composition creates no namespace, and still reports the default host", () => {
  const service = composition(render(...suborgOn(false)), "service-local");
  assert.doesNotMatch(service, /kind: Namespace/);
  assert.match(service, /defaultHost:/);
});

test("with suborg-tenancy off the Service composition still creates one namespace per environment", () => {
  const service = composition(render(), "service-local");
  assert.match(service, /kind: Namespace/);
});
