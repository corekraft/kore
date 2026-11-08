import { migrate } from "./migrate.ts";
import { connect, databaseConfigFromEnv } from "./postgres.ts";

try {
  const connection = await connect(databaseConfigFromEnv(process.env));
  try {
    const applied = await migrate(connection);
    console.log(JSON.stringify({ severity: "INFO", message: "migrations complete", applied }));
  } finally {
    await connection.close();
  }
} catch (error) {
  console.error(JSON.stringify({ severity: "ERROR", message: "migration failed", reason: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
}
