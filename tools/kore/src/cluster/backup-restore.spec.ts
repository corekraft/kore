import { beforeEach, expect, test, vi } from "vitest";
import type { BackupManifest } from "./backup-manifest.js";
import { decryptBackup } from "./backup-restore.js";
import { sha256 } from "./export-manifest.js";

vi.mock("./export-manifest.js");

const CIPHER = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n";
const PLAIN = "CREATE TABLE t (id int);\n";

function manifest(postgresMajor: number): BackupManifest {
  return {
    version: 1,
    environment: "vps",
    createdAt: "2026-11-23T04:05:06.000Z",
    recipient: "age1x",
    contents: {
      kind: "cnpg-database",
      namespace: "golden-path",
      cluster: "pg-main",
      database: "app",
      format: "pg_dump-plain",
    },
    artifact: {
      file: "2026-11-23T04-05-06Z.sql.age",
      sha256: "digest-of-the-ciphertext",
      bytes: Buffer.byteLength(CIPHER),
    },
    target: { kind: "off-host" },
    recipients: ["age1x"],
    dump: { tool: "pg_dump", version: "18.1", postgresMajor },
  };
}

beforeEach(() => {
  vi.mocked(sha256).mockReturnValue("digest-of-the-ciphertext");
});

test("a backup from the server's own PostgreSQL major is decrypted and its plaintext returned", async () => {
  const decrypt = vi.fn(async () => PLAIN);
  await expect(decryptBackup(manifest(17), 17, CIPHER, decrypt)).resolves.toBe(
    PLAIN,
  );
  expect(decrypt).toHaveBeenCalledWith(CIPHER);
});

test("a PostgreSQL major mismatch is reported before any decryption is attempted", async () => {
  const decrypt = vi.fn(async () => PLAIN);
  await expect(
    decryptBackup(manifest(17), 16, CIPHER, decrypt),
  ).rejects.toThrow(
    "the backup was taken from PostgreSQL 17 and this server is 16; restore needs the same major, so nothing was decrypted",
  );
  expect(decrypt).not.toHaveBeenCalled();
});

test("an object whose digest no longer matches its manifest is refused before any decryption", async () => {
  vi.mocked(sha256).mockReturnValue("digest-of-something-else");
  const decrypt = vi.fn(async () => PLAIN);
  await expect(
    decryptBackup(manifest(17), 17, CIPHER, decrypt),
  ).rejects.toThrow(
    "the stored object does not match its manifest (digest or size differs); nothing was decrypted",
  );
  expect(decrypt).not.toHaveBeenCalled();
});
