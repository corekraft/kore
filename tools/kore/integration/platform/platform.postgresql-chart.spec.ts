import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0137-the-postgresql-composition-becomes-a-chart-that-takes-database-routes-behind-database-routes.md
// The PostgreSQL composition is a chart (ADR 0137). With database-routes off it
// renders the manifests it replaced, byte for byte; on, it adds the derived name,
// the local CA's certificate and the verifying connection keys. Rendered offline
// with helm and the Go template engine that function-go-templating uses.

const run = promisify(execFile);

const databaseRoutes = [
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

async function chart(...set: string[]): Promise<string> {
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
function documents(stdout: string): string[] {
  return stdout
    .split(/^---$/m)
    .map((doc) =>
      doc.replace(/^\s*# Source: [^\n]*\n/, "").replace(/\n+$/, "\n"),
    )
    .filter((doc) => doc.trim() !== "");
}

const kind = (stdout: string, name: string) =>
  documents(stdout).find((doc) => new RegExp(`^kind: ${name}$`, "m").test(doc));

/** The inline Go template of one pipeline step, dedented, as function-go-templating reads it. */
function inlineTemplate(stdout: string, step: string): string {
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
async function renderStep(
  template: string,
  version: number,
  database?: object,
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
            storageSize: "5Gi",
            connectionSecretName: "orders-db-conn",
          },
        },
      },
      resources: database
        ? { database: { resource: { status: database } } }
        : {},
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

const secretKeys = (doc: string) =>
  doc
    .slice(doc.indexOf("stringData:"))
    .split("\n")
    .slice(1)
    .map((line) => /^ {2}(\w+):/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);

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
