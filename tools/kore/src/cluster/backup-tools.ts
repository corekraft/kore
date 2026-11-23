import type { Runner } from "../runtime/index.js";
import { parseDumpHeader, type DumpHeader } from "./backup-header.js";
import { ageArguments } from "./export.js";

export interface DumpResult {
  /** The plaintext dump. It lives in memory only, never on disk. */
  plaintext: string;
  header: DumpHeader;
}

/**
 * Runs pg_dump against the database the environment names. Connection settings
 * come from the libpq environment, never from arguments. The dump is refused
 * here when its header cannot say which PostgreSQL major it came from.
 */
export async function dumpDatabase(
  runner: Runner,
  database: string,
): Promise<DumpResult> {
  const result = await runner.run(
    "pg_dump",
    ["--format=plain", "--no-password", `--dbname=${database}`],
    { capture: true },
  );
  return { plaintext: result.stdout, header: parseDumpHeader(result.stdout) };
}

/** Encrypts the dump to every recipient and returns the armored ciphertext only. */
export async function encryptDump(
  runner: Runner,
  recipients: readonly string[],
  plaintext: string,
): Promise<string> {
  const result = await runner.run("age", ageArguments(recipients), {
    capture: true,
    input: plaintext,
  });
  return result.stdout;
}
