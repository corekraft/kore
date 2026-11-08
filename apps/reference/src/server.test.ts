import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { startFakePostgres } from "./testing/fake-postgres.ts";

async function availablePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test("frontend preserves an upstream authorization denial status", async () => {
  const forwardedRoles: string[] = [];
  const api = createServer((request, response) => {
    forwardedRoles.push(String(request.headers["x-kore-authenticated-role"]));
    if (request.headers["x-kore-authenticated-role"] === "developer") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ role: "developer" }));
    } else {
      response.writeHead(403);
      response.end();
    }
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const apiAddress = api.address();
  assert.ok(apiAddress && typeof apiAddress !== "string");

  const port = await availablePort();
  const app = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
    env: {
      ...process.env,
      APP_MODE: "frontend",
      API_URL: `http://127.0.0.1:${apiAddress.port}`,
      API_TOKEN: "test-token",
      PORT: String(port),
    },
    stdio: "ignore",
  });

  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/protected`, {
          headers: { "x-kore-role": "developer" },
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(response, "frontend server should start");
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "upstream request denied" });
    assert.deepEqual(forwardedRoles, ["viewer"]);

    const authenticated = await fetch(`http://127.0.0.1:${port}/api/protected`, {
      headers: { authorization: "Bearer test-token", "x-kore-role": "viewer" },
    });
    assert.equal(authenticated.status, 200);
    assert.deepEqual(await authenticated.json(), { role: "developer" });
    assert.deepEqual(forwardedRoles, ["viewer", "developer"]);
  } finally {
    app.kill("SIGTERM");
    await new Promise<void>((resolve) => app.once("exit", () => resolve()));
    await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  }
});

test("one request emits correlated OTLP traces, logs, and metrics", async () => {
  const signals = new Map<string, unknown>();
  const collector = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    signals.set(request.url ?? "", JSON.parse(Buffer.concat(chunks).toString("utf8")));
    response.writeHead(200);
    response.end();
  });
  collector.listen(0, "127.0.0.1");
  await once(collector, "listening");
  const collectorAddress = collector.address();
  assert.ok(collectorAddress && typeof collectorAddress !== "string");
  const port = await availablePort();
  const app = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
    env: {
      ...process.env,
      APP_MODE: "api",
      OTEL_SERVICE_NAME: "reference-telemetry-test",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collectorAddress.port}`,
      PORT: String(port),
      PGHOST: "127.0.0.1",
      PGPORT: "1",
    },
    stdio: "ignore",
  });

  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api`, {
          headers: { traceparent: "00-12345678901234567890123456789012-1234567890123456-01" },
        });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(response, "reference API should start");
    assert.equal(response.status, 200);
    for (let attempt = 0; attempt < 50 && signals.size < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.deepEqual([...signals.keys()].sort(), ["/v1/logs", "/v1/metrics", "/v1/traces"]);
    const traces = signals.get("/v1/traces") as any;
    const logs = signals.get("/v1/logs") as any;
    const metrics = signals.get("/v1/metrics") as any;
    const span = traces.resourceSpans[0].scopeSpans[0].spans[0];
    const log = logs.resourceLogs[0].scopeLogs[0].logRecords[0];
    const point = metrics.resourceMetrics[0].scopeMetrics[0].metrics[0];
    assert.equal(span.traceId, "12345678901234567890123456789012");
    assert.equal(log.traceId, span.traceId);
    assert.equal(point.name, "http.server.request.count");
    for (const attributes of [span.attributes, log.attributes, point.sum.dataPoints[0].attributes]) {
      assert.ok(attributes.some(({ key, value }) => key === "service.name" && value.stringValue === "reference-telemetry-test"));
      assert.ok(attributes.some(({ key, value }) => key === "http.route" && value.stringValue === "/api"));
    }
  } finally {
    app.kill("SIGTERM");
    await new Promise<void>((resolve) => app.once("exit", () => resolve()));
    await new Promise<void>((resolve, reject) => collector.close((error) => error ? reject(error) : resolve()));
  }
});

async function startApp(env: Record<string, string>): Promise<{ port: number; stop: () => Promise<void> }> {
  const port = await availablePort();
  const app = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
    env: { ...process.env, APP_MODE: "api", PORT: String(port), ...env },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(`http://127.0.0.1:${port}/livez`); break; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  return { port, stop: async () => { app.kill("SIGTERM"); await new Promise<void>((resolve) => app.once("exit", () => resolve())); } };
}

const databaseEnv = (port: number, password: string | undefined) => ({
  PGHOST: "127.0.0.1", PGPORT: String(port), PGDATABASE: "app", PGUSER: "app", PGSSLMODE: "disable",
  ...(password === undefined ? {} : { PGPASSWORD: password }),
});

test("readiness authenticates to the database and runs a query", async () => {
  const database = await startFakePostgres({ user: "app", password: "pw", database: "app" });
  const app = await startApp(databaseEnv(database.port, "pw"));
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/readyz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ready: true });
    assert.deepEqual(database.queries, ["SELECT 1"]);
  } finally { await app.stop(); await database.close(); }
});

test("readiness fails when the database accepts TCP but rejects the credentials", async () => {
  const database = await startFakePostgres({ user: "app", password: "pw", database: "app" });
  const app = await startApp(databaseEnv(database.port, "wrong"));
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/readyz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ready: false });
    const api = await fetch(`http://127.0.0.1:${app.port}/api`);
    assert.equal(((await api.json()) as { database: boolean }).database, false);
    assert.deepEqual(database.queries, []);
  } finally { await app.stop(); await database.close(); }
});

test("readiness fails when no password is injected", async () => {
  const database = await startFakePostgres({ user: "app", password: "pw", database: "app" });
  const app = await startApp(databaseEnv(database.port, undefined));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/readyz`)).status, 503);
  } finally { await app.stop(); await database.close(); }
});

async function runMigrate(env: Record<string, string>): Promise<number | null> {
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/migrate-main.ts"], { env: { ...process.env, ...env }, stdio: "ignore" });
  const [code] = (await once(child, "exit")) as [number | null];
  return code;
}

test("the migrate entrypoint applies the schema and exits zero, and a rerun is a no-op", async () => {
  const applied = new Set<string>();
  const database = await startFakePostgres({
    user: "app", password: "pw", database: "app",
    onQuery: (sql) => {
      if (/^select id from schema_migrations/i.test(sql)) return { columns: ["id"], rows: [...applied].map((id) => [id]) };
      const insert = /values \('([^']+)'\)/i.exec(sql);
      if (insert) applied.add(insert[1]!);
      return { tag: "OK" };
    },
  });
  try {
    assert.equal(await runMigrate(databaseEnv(database.port, "pw")), 0);
    const first = database.queries.length;
    assert.ok(applied.size > 0);
    assert.equal(await runMigrate(databaseEnv(database.port, "pw")), 0);
    assert.ok(!database.queries.slice(first).some((sql) => /reference_events/.test(sql)), "rerun must not reapply migrations");
  } finally { await database.close(); }
});

test("the migrate entrypoint exits non-zero when authentication fails", async () => {
  const database = await startFakePostgres({ user: "app", password: "pw", database: "app" });
  try {
    assert.notEqual(await runMigrate(databaseEnv(database.port, "wrong")), 0);
  } finally { await database.close(); }
});
