import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  enabledComponents,
  findRoot,
  helmInstalledComponents,
  loadRepository,
  orderedComponents,
  platformArgocdDeliveryFlag,
  releaseOwner,
  validateRepository,
} from "../../src/config/index.js";
import {
  namespacedKinds,
  renderedKinds,
} from "./platform-config-delivery-chart-support.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md

const run = promisify(execFile);
const handedOver = [
  "opa-authorizer",
  "kore-postgresql-api",
  "kore-policy-templates",
  "kore-policy-constraints",
  "kore-local-tls",
  "kore-platform-config",
];
const registry = "ghcr.io/corekraft/kore/charts";
const signer =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v1.0.0";

const digestOf = (name: string) =>
  `sha256:${(handedOver.indexOf(name) + 1).toString(16).repeat(64)}`;

const lock = (names: string[] = handedOver) =>
  Object.fromEntries(
    names.map((name) => [
      name,
      {
        chart: `${registry}/${name}`,
        version: "0.0.0-0123456789ab",
        digest: digestOf(name),
        signer,
      },
    ]),
  );

async function namespaces(): Promise<Record<string, string>> {
  const repository = await loadRepository("local");
  return Object.fromEntries(
    handedOver.map((name) => {
      const component = repository.catalog.components.find(
        (c) => c.name === name,
      );
      return [name, component!.namespace];
    }),
  );
}

async function render(...set: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "platform-config-delivery",
    join(root, "infra/charts/platform-config-delivery"),
    "--set-json",
    `charts=${JSON.stringify(lock())}`,
    "--set-json",
    `namespaces=${JSON.stringify(await namespaces())}`,
    "--set-string",
    "gatewayClassName=agentgateway",
    "--set-string",
    "platformDomain=kore.local",
    ...set,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
  return assert.fail("expected the render to fail");
}

const applications = async () =>
  (await render()).filter((doc) => /^kind: Application$/m.test(doc));

test("one Application per handed-over release plus one AppProject, and never one for the image policy", async () => {
  const docs = await render();
  const names = (await applications())
    .map((doc) => /^ {2}name: (.+)$/m.exec(doc)![1])
    .sort();
  assert.deepEqual(names, [...handedOver].sort());
  assert.equal(docs.filter((d) => /^kind: AppProject$/m.test(d)).length, 1);
  assert.equal(docs.length, handedOver.length + 1);
  assert.equal(docs.join("\n").includes("kore-image-policy"), false);
});

test("each Application pulls its chart as an OCI source from the platform registry, pinned by the lock's digest, never by tag or version", async () => {
  for (const doc of await applications()) {
    const name = /^ {2}name: (.+)$/m.exec(doc)![1]!;
    assert.match(doc, new RegExp(`repoURL: "oci://${registry}/${name}"`));
    assert.match(doc, /path: "\."/);
    assert.match(doc, new RegExp(`targetRevision: "${digestOf(name)}"`));
    assert.doesNotMatch(doc, /^ {4}chart: /m);
    assert.doesNotMatch(doc, /0\.0\.0-0123456789ab/);
  }
});

test("the handover keeps the Helm release name and the release namespace, so Argo CD adopts the resources Helm made", async () => {
  const spaces = await namespaces();
  for (const doc of await applications()) {
    const name = /^ {2}name: (.+)$/m.exec(doc)![1]!;
    assert.match(doc, new RegExp(`releaseName: "${name}"`));
    assert.match(
      doc,
      new RegExp(
        `server: https://kubernetes.default.svc\\n\\s+namespace: "${spaces[name]}"`,
      ),
    );
  }
});

test("only kore-platform-config is passed the gateway class kore derives, as the chart's own gateway.className", async () => {
  for (const doc of await applications()) {
    const name = /^ {2}name: (.+)$/m.exec(doc)![1]!;
    assert.equal(
      /- name: "gateway\.className"\n\s+value: "agentgateway"/.test(doc),
      name === "kore-platform-config",
    );
  }
});

test("a render without the gateway class fails rather than leaving kore-platform-config to fail at sync", async () => {
  const root = await findRoot();
  const message = await failure(
    run("helm", [
      "template",
      "x",
      join(root, "infra/charts/platform-config-delivery"),
      "--set-json",
      `charts=${JSON.stringify(lock())}`,
      "--set-json",
      `namespaces=${JSON.stringify(await namespaces())}`,
      "--set-string",
      "platformDomain=kore.local",
    ]),
  );
  assert.match(message, /gatewayClassName/);
});

test("the handover deletes nothing: no prune, no cascade finalizer, no replace", async () => {
  for (const doc of await applications()) {
    assert.match(doc, /prune: false/);
    assert.match(doc, /selfHeal: true/);
    assert.match(doc, /ServerSideApply=true/);
    assert.match(doc, /PruneLast=true/);
    assert.doesNotMatch(doc, /finalizers/);
    assert.doesNotMatch(doc, /prune: true/);
    assert.doesNotMatch(doc, /Replace=true/);
    assert.doesNotMatch(doc, /Force=true/);
  }
});

test("a delivered release's namespace has one owner, Argo CD through CreateNamespace, and the chart renders no Namespace object", async () => {
  for (const doc of await applications()) {
    const name = /^ {2}name: (.+)$/m.exec(doc)![1]!;
    assert.match(doc, /CreateNamespace=true/, name);
  }
  const docs = await render();
  assert.equal(
    docs.some((d) => /^kind: Namespace$/m.test(d)),
    false,
  );
});

test("the AppProject whitelists the core-group Namespace kind, which CreateNamespace needs to create a missing release namespace", async () => {
  const project = (await render()).find((d) => /^kind: AppProject$/m.test(d))!;
  assert.match(project, /- group: ""\n\s+kind: Namespace\n/);
});

test("the Applications sit in an AppProject that allows only the platform registry and the release namespaces, and only platform operators may change it", async () => {
  const project = (await render()).find((d) => /^kind: AppProject$/m.test(d))!;
  assert.match(project, /name: platform-configuration/);
  for (const name of handedOver) {
    assert.ok(project.includes(`- "oci://${registry}/${name}"`), name);
  }
  assert.equal(project.includes(`- "${registry}"`), false);
  assert.doesNotMatch(project, /sourceRepos:\n\s+- "\*"/);
  for (const doc of await applications()) {
    const source = /repoURL: "(.+)"/.exec(doc)![1]!;
    assert.ok(project.includes(`- "${source}"`), source);
  }
  for (const namespace of new Set(Object.values(await namespaces()))) {
    assert.ok(project.includes(`namespace: "${namespace}"`), namespace);
  }
  assert.doesNotMatch(project, /namespace: "\*"/);
  assert.match(project, /groups:\n\s+- "platform-operators"/);
  assert.match(
    project,
    /p, proj:platform-configuration:operators, applications, \*, platform-configuration\/\*, allow/,
  );
  for (const doc of await applications()) {
    assert.match(doc, /project: "platform-configuration"/);
    assert.doesNotMatch(doc, /project: "?default/);
  }
});

test("a lock entry without a sha256 digest is refused so a tag never reaches the cluster", async () => {
  const tagged = {
    ...lock(),
    "kore-local-tls": { ...lock()["kore-local-tls"]!, digest: "latest" },
  };
  const message = await failure(
    render("--set-json", `charts=${JSON.stringify(tagged)}`),
  );
  assert.match(message, /digest/);
});

test("a missing lock entry fails the render rather than handing over only some releases", async () => {
  const partial = lock(handedOver.slice(1));
  const message = await failure(
    render("--set-json", `charts=${JSON.stringify(partial)}`),
  );
  assert.match(message, /opa-authorizer/);
});

test("an image policy lock entry is refused, because kore keeps that release", async () => {
  const extra = { ...lock(), ...lock(["kore-image-policy"]) };
  const message = await failure(
    render("--set-json", `charts=${JSON.stringify(extra)}`),
  );
  assert.match(message, /kore-image-policy/);
});

test("a release without a namespace fails the render rather than guessing one", async () => {
  const spaces = await namespaces();
  delete spaces["kore-local-tls"];
  const message = await failure(
    render("--set-json", `namespaces=${JSON.stringify(spaces)}`),
  );
  assert.match(message, /kore-local-tls/);
});

test("the delivery chart is a gated release owned by kore, installed after Argo CD, so Helm never owns what it creates", async () => {
  const name = "kore-config-delivery";
  for (const environment of ["local", "managed-example"]) {
    const repository = await loadRepository(environment);
    await validateRepository(repository);
    assert.equal(
      enabledComponents(repository).some((c) => c.name === name),
      false,
      `${environment} installs nothing with the flag off`,
    );
  }
  const repository = await loadRepository("local");
  const on = {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        [platformArgocdDeliveryFlag]: true,
        "platform-organization-service-apis": true,
      },
    },
  };
  await validateRepository(on);
  const component = on.catalog.components.find((c) => c.name === name)!;
  assert.equal(releaseOwner(on.environment, component), "kore");
  assert.ok(helmInstalledComponents(on, false).some((c) => c.name === name));
  const order = orderedComponents(on.catalog).map((c) => c.name);
  assert.ok(order.indexOf("argocd") < order.indexOf(name));
});

test("the AppProject whitelists exactly the cluster-scoped kinds the six charts render, with no wildcard", async () => {
  const project = (await render()).find((d) => /^kind: AppProject$/m.test(d))!;
  const whitelist = project.slice(project.indexOf("clusterResourceWhitelist:"));
  const listed = [...whitelist.matchAll(/ kind: (\S+)/g)].map((m) => m[1]!);
  assert.doesNotMatch(whitelist.split("roles:")[0]!, /["']?\*["']?/);
  const rendered = new Set<string>();
  for (const name of handedOver) {
    for (const kind of await renderedKinds(name)) {
      rendered.add(kind);
    }
  }
  const clusterScoped = [...rendered].filter((k) => !namespacedKinds.has(k));
  assert.deepEqual([...clusterScoped].sort(), [...listed].sort());
  assert.ok(clusterScoped.includes("ConstraintTemplate"));
  assert.ok(clusterScoped.includes("Composition"));
});
