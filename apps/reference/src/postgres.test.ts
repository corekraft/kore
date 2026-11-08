import assert from "node:assert/strict";
import { test } from "node:test";
import {
  connect,
  databaseConfigFromEnv,
  type DatabaseConfig,
} from "./postgres.ts";
import { startFakePostgres } from "./testing/fake-postgres.ts";

const credentials = { user: "app", password: "s3cret-pass", database: "app" };
const config = (
  port: number,
  overrides: Partial<DatabaseConfig> = {},
): DatabaseConfig => ({
  host: "127.0.0.1",
  port,
  database: "app",
  user: "app",
  password: "s3cret-pass",
  sslmode: "disable",
  ...overrides,
});

test("authenticates with SCRAM-SHA-256 and returns query rows as text", async () => {
  const server = await startFakePostgres(credentials);
  try {
    const connection = await connect(config(server.port));
    assert.deepEqual(await connection.query("SELECT 1"), [["1"]]);
    await connection.close();
    assert.deepEqual(server.startup[0], { user: "app", database: "app" });
  } finally {
    await server.close();
  }
});

test("a wrong password is rejected without echoing the password", async () => {
  const server = await startFakePostgres(credentials);
  try {
    await assert.rejects(
      connect(config(server.port, { password: "wrong-password" })),
      (error: Error) => {
        assert.match(error.message, /password authentication failed/);
        assert.ok(!error.message.includes("wrong-password"));
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("a missing password is rejected before any connection is attempted", async () => {
  await assert.rejects(connect(config(1, { password: "" })), /password/i);
});

test("a server that cannot prove it knows the password is rejected", async () => {
  const server = await startFakePostgres({
    ...credentials,
    forgeServerSignature: true,
  });
  try {
    await assert.rejects(connect(config(server.port)), /server signature/i);
  } finally {
    await server.close();
  }
});

test("a server error surfaces as an error with the server message", async () => {
  const server = await startFakePostgres({
    ...credentials,
    onQuery: () => ({ error: "relation missing", code: "42P01" }),
  });
  try {
    const connection = await connect(config(server.port));
    await assert.rejects(
      connection.query("SELECT * FROM missing"),
      /relation missing/,
    );
    await connection.close();
  } finally {
    await server.close();
  }
});

test("sslmode=require upgrades the connection to TLS", async () => {
  const server = await startFakePostgres({ ...credentials, tls: true });
  try {
    const connection = await connect(
      config(server.port, { sslmode: "require" }),
    );
    assert.deepEqual(await connection.query("SELECT 1"), [["1"]]);
    await connection.close();
  } finally {
    await server.close();
  }
});

test("sslmode=require fails closed when the server offers no TLS", async () => {
  const server = await startFakePostgres(credentials);
  try {
    await assert.rejects(
      connect(config(server.port, { sslmode: "require" })),
      /does not support TLS/,
    );
    assert.equal(
      server.startup.length,
      0,
      "credentials must not be sent in plaintext",
    );
  } finally {
    await server.close();
  }
});

test("unsupported sslmode values are rejected rather than downgraded", async () => {
  assert.throws(
    () =>
      databaseConfigFromEnv({
        PGHOST: "h",
        PGUSER: "u",
        PGDATABASE: "d",
        PGPASSWORD: "p",
        PGSSLMODE: "verify-full",
      }),
    /sslmode/,
  );
});

test("database config is read from the standard PG environment variables", () => {
  assert.deepEqual(
    databaseConfigFromEnv({
      PGHOST: "db",
      PGPORT: "5433",
      PGUSER: "u",
      PGDATABASE: "d",
      PGPASSWORD: "p",
      PGSSLMODE: "require",
    }),
    {
      host: "db",
      port: 5433,
      user: "u",
      database: "d",
      password: "p",
      sslmode: "require",
    },
  );
});

test("a stalled query is bounded by a deadline that destroys the socket", async () => {
  const server = await startFakePostgres({
    ...credentials,
    stallQueries: true,
  });
  try {
    const connection = await connect(config(server.port), 5000, 150);
    const started = Date.now();
    await assert.rejects(
      connection.query("SELECT 1"),
      /database query timed out after 150ms/,
    );
    assert.ok(Date.now() - started < 2000);
    await assert.rejects(connection.query("SELECT 1"));
  } finally {
    await server.close();
  }
});
