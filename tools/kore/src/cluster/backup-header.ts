const SOURCE_VERSION = /^-- Dumped from database version (\d+)(?:\.\d+)*/m;
const TOOL_VERSION = /^-- Dumped by pg_dump version (\d+(?:\.\d+)*)/m;

export interface DumpHeader {
  /** The major of the database the dump was taken from; restore refuses a different one. */
  postgresMajor: number;
  /** The pg_dump that wrote the dump, as it reports itself. */
  dumpVersion: string;
}

/**
 * Reads the version lines that a plain pg_dump writes at its head. Both are
 * required: a backup without them cannot say which PostgreSQL major restore
 * must match, so it is refused before anything is encrypted.
 */
export function parseDumpHeader(dump: string): DumpHeader {
  const source = SOURCE_VERSION.exec(dump);
  if (!source) {
    throw new Error(
      "the pg_dump output has no 'Dumped from database version' line, so its PostgreSQL major is unknown; the backup is not written",
    );
  }
  const tool = TOOL_VERSION.exec(dump);
  if (!tool) {
    throw new Error(
      "the pg_dump output has no 'Dumped by pg_dump version' line; the backup is not written",
    );
  }
  return { postgresMajor: Number(source[1]), dumpVersion: tool[1] ?? "" };
}
