import assert from "node:assert/strict";
import { test } from "node:test";
import { migrate, migrations } from "./migrate.ts";
import { connect } from "./postgres.ts";
import { startFakePostgres, type QueryResult } from "./testing/fake-postgres.ts";

const credentials = { user: "app", password: "pw", database: "app" };
const config = (port: number) => ({ host: "127.0.0.1", port, database: "app", user: "app", password: "pw", sslmode: "disable" as const });

function ledger(failOn?: RegExp) {
  const applied = new Set<string>();
  const handler = (sql: string): QueryResult => {
    if (failOn?.test(sql)) return { error: "boom" };
    if (/^select id from schema_migrations/i.test(sql)) return { columns: ["id"], rows: [...applied].map((id) => [id]) };
    const insert = /^insert into schema_migrations.*values \('([^']+)'\)/i.exec(sql);
    if (insert) applied.add(insert[1]!);
    return { tag: "OK" };
  };
  return { applied, handler };
}

test("migrate applies each migration once and is safe to rerun", async () => {
  const { applied, handler } = ledger();
  const server = await startFakePostgres({ ...credentials, onQuery: handler });
  try {
    const first = await connect(config(server.port));
    assert.deepEqual(await migrate(first), migrations.map((m) => m.id));
    await first.close();
    const ddl = server.queries.filter((q) => /create table/i.test(q) && !/schema_migrations/.test(q)).length;
    assert.ok(ddl >= 1);

    const second = await connect(config(server.port));
    assert.deepEqual(await migrate(second), []);
    await second.close();
    assert.equal(server.queries.filter((q) => /create table/i.test(q) && !/schema_migrations/.test(q)).length, ddl, "a second run must not reapply migrations");
    assert.deepEqual([...applied], migrations.map((m) => m.id));
  } finally { await server.close(); }
});

test("migrate runs in one transaction under an advisory lock so concurrent runs serialize", async () => {
  const { handler } = ledger();
  const server = await startFakePostgres({ ...credentials, onQuery: handler });
  try {
    const connection = await connect(config(server.port));
    await migrate(connection);
    await connection.close();
    assert.equal(server.queries[0], "BEGIN");
    assert.match(server.queries[1]!, /pg_advisory_xact_lock/);
    assert.equal(server.queries.at(-1), "COMMIT");
  } finally { await server.close(); }
});

test("a failing migration rolls back and is not recorded as applied", async () => {
  const { applied, handler } = ledger(/create table if not exists reference_events/i);
  const server = await startFakePostgres({ ...credentials, onQuery: handler });
  try {
    const connection = await connect(config(server.port));
    await assert.rejects(migrate(connection), /boom/);
    await connection.close();
    assert.equal(server.queries.at(-1), "ROLLBACK");
    assert.ok(!server.queries.includes("COMMIT"));
    assert.equal(applied.size, 0);
  } finally { await server.close(); }
});

test("migration ids are unique, ordered, and idempotent SQL", () => {
  const ids = migrations.map((m) => m.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, ids.length);
  for (const m of migrations) assert.match(m.sql, /if not exists/i);
});
