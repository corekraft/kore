import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  enabledComponents,
  findRoot,
  loadRepository,
  orderedComponents,
  validateRepository,
} from "../../src/config/index.js";
import { localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md

const run = promisify(execFile);
const frontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;
const revision = "c".repeat(40);
const signer =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v1.0.0";

const lockEntries = JSON.stringify({
  "static-frontend": {
    image: "ghcr.io/corekraft/kore/static-frontend-template",
    digest: `sha256:${"a".repeat(64)}`,
    signer,
  },
  "kotlin-bff": {
    image: "ghcr.io/corekraft/kore/kotlin-bff-template",
    digest: `sha256:${"b".repeat(64)}`,
    signer,
  },
});

async function helm(chart: string, ...set: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    chart,
    join(root, "infra/charts", chart),
    ...set,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

const delivery = (...extra: string[]) =>
  helm(
    "golden-path-delivery",
    "--set",
    "repoURL=https://github.com/corekraft/kore.git",
    "--set",
    `revision=${revision}`,
    "--set",
    "environment=local",
    "--set-json",
    `templateImages=${lockEntries}`,
    ...extra,
  );

const workload = (...extra: string[]) =>
  helm(
    "golden-path-workload",
    "--set",
    "service=auth",
    "--set",
    `frontend.image=${frontend}`,
    "--set",
    `bff.image=${bff}`,
    ...extra,
  );

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String((error as { stderr?: string }).stderr);
  }
  return assert.fail("expected the render to fail");
}

test("one ApplicationSet generates an Application per Service registration found in git", async () => {
  const docs = await delivery();
  assert.equal(docs.length, 1);
  const set = docs[0]!;
  assert.match(set, /^kind: ApplicationSet$/m);
  assert.match(set, /namespace: argocd/);
  assert.match(set, /goTemplate: true/);
  assert.match(set, /repoURL: "https:\/\/github.com\/corekraft\/kore.git"/);
  assert.match(set, new RegExp(`revision: "${revision}"`));
  assert.match(set, /path: "infra\/services\/\*\.yaml"/);
});

test("the generated Application deploys both template images by the lock's digest and never by tag", async () => {
  const set = (await delivery())[0]!;
  assert.ok(set.includes(`value: "${frontend}"`));
  assert.ok(set.includes(`value: "${bff}"`));
  assert.doesNotMatch(set, /:latest/);
});

test("the sync owns the workload and its namespace: the Application creates the namespace only when absent, and prunes what it deploys", async () => {
  const set = (await delivery())[0]!;
  assert.match(set, /namespace: '\{\{ \.metadata\.name \}\}--local'/);
  assert.match(set, /prune: true/);
  assert.match(set, /selfHeal: true/);
  assert.match(set, /syncOptions:\n\s+- CreateNamespace=true\n/);
  assert.doesNotMatch(set, /Replace=true/);
  assert.doesNotMatch(set, /Force=true/);
  assert.doesNotMatch(set, /kind: Namespace/);
});

test("with sharedGateway the sync labels each app namespace it creates with the platform-owned shared-gateway label", async () => {
  const set = (await delivery("--set", "sharedGateway=true"))[0]!;
  assert.match(
    set,
    /syncOptions:\n\s+- CreateNamespace=true\n\s+managedNamespaceMetadata:\n\s+labels:\n\s+platform\.kore\.dev\/shared-gateway: "true"/,
  );
});

test("without sharedGateway the sync sets no namespace metadata, so app namespaces are unchanged", async () => {
  const set = (await delivery())[0]!;
  assert.doesNotMatch(set, /managedNamespaceMetadata/);
  assert.doesNotMatch(set, /shared-gateway/);
});

test("the generated Application carries the service's part-of label, so Backstage finds it with the same selector as the workload", async () => {
  const set = (await delivery())[0]!;
  assert.match(
    set,
    /labels:\n\s+platform\.kore\.dev\/service: '\{\{ \.metadata\.name \}\}'\n\s+app\.kubernetes\.io\/part-of: '\{\{ \.metadata\.name \}\}'/,
  );
});

test("a template image without a sha256 digest is refused so a tag never reaches the cluster", async () => {
  const tagged = JSON.stringify({
    "static-frontend": { image: "ghcr.io/x/a", digest: "latest" },
    "kotlin-bff": { image: "ghcr.io/x/b", digest: `sha256:${"b".repeat(64)}` },
  });
  const message = await failure(
    delivery("--set-json", `templateImages=${tagged}`),
  );
  assert.match(message, /digest/);
});

test("a missing template lock entry fails the render rather than rendering a partial deploy", async () => {
  const partial = JSON.stringify({
    "static-frontend": {
      image: "ghcr.io/x/a",
      digest: `sha256:${"a".repeat(64)}`,
    },
  });
  const message = await failure(
    delivery("--set-json", `templateImages=${partial}`),
  );
  assert.match(message, /kotlin-bff/);
});

test("a branch name is refused as the revision so the sync follows a reviewed commit", async () => {
  const message = await failure(delivery("--set", "revision=main"));
  assert.match(message, /revision/);
});

test("the workload chart deploys the frontend and the BFF by digest, each with its Service", async () => {
  const docs = await workload();
  const kinds = docs.map((d) => /^kind: (\w+)$/m.exec(d)![1]).sort();
  assert.deepEqual(kinds, ["Deployment", "Deployment", "Service", "Service"]);
  const joined = docs.join("\n");
  assert.ok(joined.includes(`image: "${frontend}"`));
  assert.ok(joined.includes(`image: "${bff}"`));
  assert.match(joined, /allowPrivilegeEscalation: false/);
  assert.match(joined, /runAsNonRoot: true/);
});

test("the workload chart refuses an image reference that carries no digest", async () => {
  const message = await failure(
    workload("--set", "frontend.image=ghcr.io/x/a:1.0.0"),
  );
  assert.match(message, /frontend\/image.*sha256/);
});

test("the delivery chart is a gated catalog release installed after Argo CD and the Service API, and the workload chart is never a catalog release", async () => {
  const name = "kore-golden-path-delivery";
  const managed = await loadRepository("managed-example");
  await validateRepository(managed);
  assert.equal(
    enabledComponents(managed).some((c) => c.name === name),
    false,
    "managed-example installs nothing with the flag off",
  );
  const repository = await loadRepository("local");
  await validateRepository(repository);
  assert.equal(
    repository.catalog.components.some((c) =>
      /golden-path-workload/.test(c.chart ?? ""),
    ),
    false,
    "kore never applies the workload; the sync owns it",
  );
  const on = repository;
  assert.equal(
    enabledComponents(on).some((c) => c.name === name),
    true,
    "local declares the flag on",
  );
  const order = orderedComponents(on.catalog).map((c) => c.name);
  assert.ok(order.includes(name));
  assert.ok(order.indexOf("argocd") < order.indexOf(name));
  assert.ok(order.indexOf("kore-platform-apis") < order.indexOf(name));
});

const ingressSet = [
  "--set",
  `ingress.host=auth.acme.${platform.domain}`,
  "--set",
  "ingress.gatewayClassName=agentgateway",
  "--set",
  "ingress.issuer=kore-local-ca",
];

const kindOf = (doc: string) => /^kind: (\w+)$/m.exec(doc)![1];

test("a service host gets a Gateway listener, a Certificate and an HTTPRoute, all rendered into the service namespace by the sync", async () => {
  const docs = await workload(...ingressSet);
  assert.deepEqual(docs.map(kindOf).sort(), [
    "Certificate",
    "Deployment",
    "Deployment",
    "Gateway",
    "HTTPRoute",
    "Service",
    "Service",
  ]);
  const gateway = docs.find((d) => kindOf(d) === "Gateway")!;
  assert.match(gateway, /gatewayClassName: "agentgateway"/);
  assert.ok(gateway.includes(`hostname: "auth.acme.${platform.domain}"`));
  assert.match(gateway, /protocol: HTTPS/);
  assert.match(gateway, /mode: Terminate/);
  assert.match(gateway, /name: auth-tls/);
  assert.match(gateway, /from: Same/);
});

test("the certificate covers exactly the service host and is issued by the platform issuer into the Secret the listener names", async () => {
  const docs = await workload(...ingressSet);
  const cert = docs.find((d) => kindOf(d) === "Certificate")!;
  assert.match(cert, /secretName: auth-tls/);
  assert.ok(cert.includes(`- "auth.acme.${platform.domain}"`));
  assert.match(cert, /kind: ClusterIssuer/);
  assert.match(cert, /name: kore-local-ca/);
});

test("the route sends the BFF path to the BFF and everything else to the frontend, through the service's own gateway", async () => {
  const docs = await workload(...ingressSet);
  const route = docs.find((d) => kindOf(d) === "HTTPRoute")!;
  assert.ok(route.includes(`- "auth.acme.${platform.domain}"`));
  assert.match(route, /kind: Gateway\n\s+name: auth\n/);
  assert.match(route, /value: \/api/);
  assert.match(route, /name: auth-bff/);
  assert.match(route, /name: auth-frontend/);
});

test("the workload chart renders no ingress resource unless a host is given, so the flag-off path is unchanged", async () => {
  const kinds = (await workload()).map(kindOf);
  for (const kind of ["Gateway", "HTTPRoute", "Certificate"]) {
    assert.equal(kinds.includes(kind), false, `${kind} without a host`);
  }
});

test("a host without a gateway class is refused so no listener is rendered for a class that does not exist", async () => {
  const message = await failure(
    workload("--set", `ingress.host=auth.acme.${platform.domain}`),
  );
  assert.match(message, /gatewayClassName/);
});

test("the ApplicationSet derives each host from the registration's organization and the platform domain, as the Service composition does", async () => {
  const docs = await delivery(
    "--set",
    `ingress.platformDomain=${platform.domain}`,
    "--set",
    "ingress.gatewayClassName=agentgateway",
  );
  const set = docs[0]!;
  assert.match(set, /name: ingress.host/);
  assert.ok(
    set.includes(
      `value: '{{ .metadata.name }}.{{ .spec.organization }}.${platform.domain}'`,
    ),
  );
  assert.match(set, /name: ingress.gatewayClassName/);
  assert.match(set, /value: "agentgateway"/);
  assert.match(set, /name: ingress.issuer/);
  assert.match(set, /value: "kore-local-ca"/);
});

test("the ApplicationSet passes no ingress parameter unless the platform domain is set", async () => {
  const set = (await delivery())[0]!;
  assert.doesNotMatch(set, /ingress\./);
});

test("an ingress without a gateway class is refused by the delivery chart", async () => {
  const message = await failure(
    delivery("--set", `ingress.platformDomain=${platform.domain}`),
  );
  assert.match(message, /gatewayClassName/);
});
