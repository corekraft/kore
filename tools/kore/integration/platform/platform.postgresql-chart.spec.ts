import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";
import {
  chart,
  databaseRoutes,
  documents,
  inlineTemplate,
  kind,
  renderStep,
  secretKeys,
} from "./platform.postgresql-chart-support.js";

// Docs: docs/decisions/0137-the-postgresql-composition-becomes-a-chart-that-takes-database-routes-behind-database-routes.md
// The PostgreSQL composition is a chart (ADR 0137). With database-routes off it
// renders the manifests it replaced, byte for byte; on, it adds the derived name,
// the local CA's certificate and the verifying connection keys. Rendered offline
// with helm and the Go template engine that function-go-templating uses.

test("with database-routes off the chart renders the composition and the definition byte-for-byte as the manifests they replace", async () => {
  const root = await findRoot();
  const rendered = documents(await chart());
  const composition = await readFile(
    join(root, "infra/apis/postgresql/compositions/local.yaml"),
    "utf8",
  );
  const definition = await readFile(
    join(root, "infra/apis/postgresql/definitions/postgresqlinstance.yaml"),
    "utf8",
  );
  assert.equal(
    rendered.length,
    2,
    "exactly the definition and the composition",
  );
  assert.equal(rendered[0], definition);
  assert.equal(rendered[1], composition);
});

test("with database-routes off the connection Secret keeps exactly its six keys", async () => {
  const out = await renderStep(
    inlineTemplate(await chart(), "compose-cloudnative-pg"),
    17,
  );
  const secret = kind(out, "Secret") ?? "";
  assert.deepEqual(secretKeys(secret), [
    "host",
    "port",
    "database",
    "username",
    "passwordSecretRef",
    "sslmode",
  ]);
});

test("with database-routes on the connection Secret keeps its six keys and adds the derived name, port and verifying SSL mode", async () => {
  const out = await renderStep(
    inlineTemplate(await chart(...databaseRoutes), "compose-cloudnative-pg"),
    17,
  );
  const secret = kind(out, "Secret") ?? "";
  assert.deepEqual(secretKeys(secret), [
    "host",
    "port",
    "database",
    "username",
    "passwordSecretRef",
    "sslmode",
    "externalHost",
    "externalPort",
    "externalSslmode",
  ]);
  assert.match(secret, /^ {2}host: orders-db-rw$/m);
  assert.match(secret, /^ {2}sslmode: require$/m);
  assert.match(
    secret,
    /^ {2}externalHost: orders-db\.platform\.kore\.internal$/m,
  );
  assert.match(secret, /^ {2}externalPort: "5432"$/m);
  assert.match(secret, /^ {2}externalSslmode: verify-full$/m);
});

for (const version of [17, 18]) {
  test(`with database-routes on a Postgres ${version} database a certificate from the local CA covers its derived name and service names, and CloudNativePG serves it`, async () => {
    const out = await renderStep(
      inlineTemplate(await chart(...databaseRoutes), "compose-cloudnative-pg"),
      version,
    );
    const certificate = kind(out, "Certificate") ?? "";
    assert.match(certificate, /^apiVersion: cert-manager\.io\/v1$/m);
    assert.match(certificate, /^ {2}name: orders-db-server$/m);
    assert.match(certificate, /^ {2}namespace: orders$/m);
    assert.match(certificate, /^ {2}secretName: orders-db-server-tls$/m);
    assert.match(certificate, /^ {6}cnpg\.io\/reload: ""$/m);
    const names = [...certificate.matchAll(/^ {4}- (\S+)$/gm)].map((m) => m[1]);
    assert.deepEqual(names, [
      "orders-db.platform.kore.internal",
      "orders-db-rw",
      "orders-db-rw.orders.svc",
      "orders-db-ro",
      "orders-db-ro.orders.svc",
      "orders-db-r",
      "orders-db-r.orders.svc",
    ]);
    assert.match(certificate, /^ {4}kind: ClusterIssuer$/m);
    assert.match(certificate, /^ {4}name: kore-local-ca$/m);
    const cluster = kind(out, "Cluster") ?? "";
    assert.match(
      cluster,
      /^ {2}certificates:\n {4}serverTLSSecret: orders-db-server-tls\n {4}serverCASecret: orders-db-server-tls$/m,
    );
    assert.match(
      cluster,
      new RegExp(`imageName: .*postgresql:${version}\\.\\d+@sha256:`),
    );
  });
}

test("with database-routes on a Postgres 16 database no certificate is composed and CloudNativePG gets no certificate fields", async () => {
  const out = await renderStep(
    inlineTemplate(await chart(...databaseRoutes), "compose-cloudnative-pg"),
    16,
  );
  assert.equal(kind(out, "Certificate"), undefined);
  assert.doesNotMatch(out, /certificates:/);
  assert.doesNotMatch(out, /serverTLSSecret/);
});

test("with database-routes on a Postgres 16 database reports ReachableByName False, not DatabaseHealthy alone, and says to use the port forward", async () => {
  const out = await renderStep(
    inlineTemplate(await chart(...databaseRoutes), "project-status"),
    16,
    { phase: "Cluster in healthy state" },
  );
  assert.match(
    out,
    /^ {2}- type: ReachableByName\n {4}status: "False"\n {4}reason: UnsupportedVersion\n {4}message: "Postgres 16 is not reachable by name: use the port forward"\n {4}target: CompositeAndClaim$/m,
  );
  assert.match(out, /type: DatabaseHealthy/);
});

test("with database-routes on a Postgres 17 database the status reports no ReachableByName condition", async () => {
  const out = await renderStep(
    inlineTemplate(await chart(...databaseRoutes), "project-status"),
    17,
    { phase: "Cluster in healthy state" },
  );
  assert.doesNotMatch(out, /ReachableByName/);
});

test("with database-routes on the chart refuses to render until the platform domain is set, naming the field", async () => {
  await assert.rejects(
    chart(
      "--set",
      "databaseRoutes=true",
      "--set-string",
      "organizationId=platform",
    ),
    /platformDomain/,
  );
});
