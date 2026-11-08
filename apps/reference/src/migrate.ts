import type { Connection } from "./postgres.ts";

export interface Migration {
  id: string;
  sql: string;
}

// Append-only and idempotent: never edit or reorder a shipped migration.
export const migrations: Migration[] = [
  {
    id: "0001-reference-events",
    sql: "CREATE TABLE IF NOT EXISTS reference_events (id bigserial PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT now(), note text NOT NULL)",
  },
];

const lockKey = 7_201_024; // arbitrary constant shared by every migrate run

export async function migrate(connection: Connection): Promise<string[]> {
  const applied: string[] = [];
  await connection.query("BEGIN");
  try {
    await connection.query(`SELECT pg_advisory_xact_lock(${lockKey})`);
    await connection.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set(
      (await connection.query("SELECT id FROM schema_migrations")).map(
        ([id]) => id,
      ),
    );
    for (const migration of migrations) {
      if (done.has(migration.id)) continue;
      await connection.query(migration.sql);
      await connection.query(
        `INSERT INTO schema_migrations (id) VALUES ('${migration.id.replaceAll("'", "''")}')`,
      );
      applied.push(migration.id);
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  return applied;
}
