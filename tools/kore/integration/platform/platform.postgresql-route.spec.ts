import assert from "node:assert/strict";
import { test } from "vitest";
import {
  chart,
  databaseRoutes,
  inlineTemplate,
  kind,
  renderStep,
} from "./platform.postgresql-chart-support.js";

// Docs: docs/decisions/0139-each-database-gets-a-tls-route-in-its-own-namespace-for-postgres-17-and-18-behind-database-routes.md
// With database-routes on, the composition emits one TLS route per Postgres 17 or
// 18 database, in the database's own namespace (ADR 0139). Rendered offline with
// helm and the Go template engine that function-go-templating uses.

for (const version of [17, 18]) {
  test(`with database-routes on a Postgres ${version} database a TLS route in its own namespace attaches to the Gateway's postgres listener and serves the derived name`, async () => {
    const out = await renderStep(
      inlineTemplate(await chart(...databaseRoutes), "compose-cloudnative-pg"),
      version,
    );
    const route = kind(out, "TLSRoute") ?? "";
    assert.match(route, /^apiVersion: gateway\.networking\.k8s\.io\/v1$/m);
    assert.match(route, /^ {2}name: orders-db$/m);
    assert.match(route, /^ {2}namespace: orders$/m);
    assert.match(
      route,
      /^spec:\n {2}parentRefs:\n {4}- group: gateway\.networking\.k8s\.io\n {6}kind: Gateway\n {6}name: kore-gateway\n {6}namespace: kore-system\n {6}sectionName: postgres\n {2}hostnames:\n {4}- orders-db\.platform\.kore\.internal\n {2}rules:\n {4}- backendRefs:\n {8}- name: orders-db-rw\n {10}port: 5432$/m,
    );
  });
}

test("with database-routes on a database's TLS route reaches only a service in its own namespace: the backend names no namespace and no ReferenceGrant is composed", async () => {
  const out = await renderStep(
    inlineTemplate(await chart(...databaseRoutes), "compose-cloudnative-pg"),
    17,
  );
  const route = kind(out, "TLSRoute") ?? "";
  const backends = route.slice(route.indexOf("backendRefs:"));
  assert.doesNotMatch(backends, /namespace:/);
  assert.equal(kind(out, "ReferenceGrant"), undefined);
});

test("with database-routes on a Postgres 16 database composes no TLS route, because it has no certificate to serve", async () => {
  const out = await renderStep(
    inlineTemplate(await chart(...databaseRoutes), "compose-cloudnative-pg"),
    16,
  );
  assert.equal(kind(out, "TLSRoute"), undefined);
  assert.doesNotMatch(out, /TLSRoute/);
});

for (const version of [16, 17, 18]) {
  test(`with database-routes off a Postgres ${version} database composes no TLS route and no certificate`, async () => {
    const out = await renderStep(
      inlineTemplate(await chart(), "compose-cloudnative-pg"),
      version,
    );
    assert.equal(kind(out, "TLSRoute"), undefined);
    assert.equal(kind(out, "Certificate"), undefined);
  });
}

test("with database-routes on the chart refuses to render until the Gateway's name and namespace are set, naming the field", async () => {
  const withoutGateway = databaseRoutes.slice(0, 6);
  await assert.rejects(chart(...withoutGateway), /gateway\.name/);
  await assert.rejects(
    chart(...withoutGateway, "--set-string", "gateway.name=kore-gateway"),
    /gateway\.namespace/,
  );
});
