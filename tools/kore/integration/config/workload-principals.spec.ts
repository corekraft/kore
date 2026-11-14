import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/config.js";
import {
  parsePrincipal,
  spiffeId,
  spiffePrincipal,
} from "../../src/config/identity.js";

// Docs: docs/decisions/0007-workload-identity-and-layered-authorization.md
const run = promisify(execFile);
const namespace = "reference";

test("a workload's SPIFFE identity is built from trust domain, namespace, and ServiceAccount", () => {
  assert.equal(
    spiffeId("cluster.local", "reference", "reference-api"),
    "spiffe://cluster.local/ns/reference/sa/reference-api",
  );
  assert.equal(
    spiffePrincipal("cluster.local", "reference", "reference-api"),
    "cluster.local/ns/reference/sa/reference-api",
  );
});

test("principals parse back to their parts and malformed ones are refused", () => {
  assert.deepEqual(parsePrincipal("cluster.local/ns/a/sa/b"), {
    trustDomain: "cluster.local",
    namespace: "a",
    serviceAccount: "b",
  });
  assert.deepEqual(parsePrincipal("spiffe://cluster.local/ns/a/sa/b"), {
    trustDomain: "cluster.local",
    namespace: "a",
    serviceAccount: "b",
  });
  for (const bad of [
    "*",
    "cluster.local/ns/*/sa/b",
    "cluster.local/ns/a/sa/*",
    "ns/a/sa/b",
    "cluster.local/ns/a/sa/",
    "cluster.local/ns/a/sa/b/extra",
    "cluster.local/ns/Bad_Name/sa/b",
  ]) {
    assert.equal(parsePrincipal(bad), undefined, bad);
  }
});

async function renderedReference(): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "reference",
    join(root, "apps/reference/charts/workload"),
    "--namespace",
    namespace,
  ]);
  return stdout;
}

async function meshTrustDomain(): Promise<string> {
  const values = await readFile(
    join(await findRoot(), "infra/environments/common/values/istiod.yaml"),
    "utf8",
  );
  const domain = /^\s+trustDomain:\s*(\S+)/m.exec(values)?.[1];
  assert.ok(domain, "istiod values declare meshConfig.trustDomain");
  return domain;
}

test("every authorization principal of the reference app follows the documented SPIFFE format in the mesh trust domain and namespace", async () => {
  const text = await renderedReference();
  const principals = [...text.matchAll(/principals:\s*\[([^\]]*)\]/g)].flatMap(
    (m) =>
      (m[1] ?? "")
        .split(",")
        .map((p) => p.trim().replace(/^"|"$/g, ""))
        .filter(Boolean),
  );
  assert.ok(principals.length >= 2, "the chart declares caller principals");
  const trustDomain = await meshTrustDomain();
  for (const principal of principals) {
    const parsed = parsePrincipal(principal);
    assert.ok(parsed, `${principal} is not a SPIFFE principal`);
    assert.equal(parsed.trustDomain, trustDomain, principal);
    assert.equal(parsed.namespace, namespace, principal);
    assert.notEqual(parsed.serviceAccount, "default", principal);
  }
});

test("every principal names a ServiceAccount the chart creates or a waypoint Istio creates for a chart Gateway", async () => {
  const text = await renderedReference();
  const documents = text.split(/^---$/m);
  const accounts = new Set(
    documents
      .filter((d) => /^kind: ServiceAccount$/m.test(d))
      .map((d) => /^\s{2}name:\s*(\S+)/m.exec(d)?.[1] ?? ""),
  );
  const waypoints = documents
    .filter(
      (d) =>
        /^kind: Gateway$/m.test(d) &&
        d.includes("gatewayClassName: istio-waypoint"),
    )
    .map((d) => /^\s{2}name:\s*(\S+)/m.exec(d)?.[1] ?? "");
  const principals = [...text.matchAll(/"[^"]*\/sa\/([^"]+)"/g)].map(
    (m) => m[1] ?? "",
  );
  assert.ok(principals.length >= 2);
  for (const account of principals) {
    assert.ok(
      accounts.has(account) || waypoints.includes(account),
      `principal ServiceAccount ${account} is neither created by the chart nor a chart waypoint`,
    );
  }
});
