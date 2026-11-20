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
  releaseOwner,
  validateRepository,
} from "../../src/config/index.js";
import {
  failure,
  handedOver,
  lock,
  namespaces,
  registry,
  render,
  digestOf,
} from "./platform-config-delivery-chart-support.js";
import { escapeRegExp, localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md

const run = promisify(execFile);
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

test("only kore-platform-config and kore-local-tls are passed the platform domain, as the charts' own gateway.hostname, over any values file", async () => {
  for (const doc of await applications()) {
    const name = /^ {2}name: (.+)$/m.exec(doc)![1]!;
    assert.equal(
      new RegExp(
        `- name: "gateway\\.hostname"\\n\\s+value: "${escapeRegExp(platform.domain)}"`,
      ).test(doc),
      name === "kore-platform-config" || name === "kore-local-tls",
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
      `platformDomain=${platform.domain}`,
      "--set-string",
      `platformHostname=*.platform.${platform.domain}`,
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
  const managed = await loadRepository("managed-example");
  await validateRepository(managed);
  assert.equal(
    enabledComponents(managed).some((c) => c.name === name),
    false,
    "managed-example installs nothing with the flag off",
  );
  const on = await loadRepository("local");
  await validateRepository(on);
  assert.equal(
    enabledComponents(on).some((c) => c.name === name),
    true,
    "local declares the flag on",
  );
  const component = on.catalog.components.find((c) => c.name === name)!;
  assert.equal(releaseOwner(on.environment, component), "kore");
  assert.ok(helmInstalledComponents(on, false).some((c) => c.name === name));
  const order = orderedComponents(on.catalog).map((c) => c.name);
  assert.ok(order.indexOf("argocd") < order.indexOf(name));
});

test("with database-routes on the PostgreSQL API's Application is handed the flag, the platform domain and the organization identifier as Helm parameters; with it off it carries none", async () => {
  const api = (docs: string[]) =>
    docs.find((doc) => /^ {2}name: kore-postgresql-api$/m.test(doc)) ?? "";
  const withRoutes = api(
    await render(
      "--set",
      "databaseRoutes=true",
      "--set-string",
      "organizationId=platform",
    ),
  );
  assert.match(withRoutes, /- name: "databaseRoutes"\n\s+value: "true"/);
  assert.match(
    withRoutes,
    new RegExp(
      `- name: "platformDomain"\\n\\s+value: "${escapeRegExp(platform.domain)}"`,
    ),
  );
  assert.match(withRoutes, /- name: "organizationId"\n\s+value: "platform"/);
  const off = api(await applications());
  assert.doesNotMatch(off, /databaseRoutes/);
  assert.doesNotMatch(off, /parameters:/);
});
