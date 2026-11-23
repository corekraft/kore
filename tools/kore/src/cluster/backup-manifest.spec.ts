import { beforeEach, expect, test, vi } from "vitest";
import { buildBackupManifest } from "./backup-manifest.js";
import { sha256 } from "./export-manifest.js";

vi.mock("./export-manifest.js");

const VPS = `age1${"q".repeat(58)}`;
const RECOVERY = `age1${"r".repeat(58)}`;
const CIPHER = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n";

const input = {
  environment: "vps",
  createdAt: "2026-11-23T04:05:06.000Z",
  namespace: "golden-path",
  cluster: "pg-main",
  database: "app",
  file: "2026-11-23T04-05-06Z.sql.age",
  ciphertext: CIPHER,
  kind: "off-host" as const,
  recipients: [VPS, RECOVERY],
  header: { postgresMajor: 17, dumpVersion: "18.1" },
};

beforeEach(() => {
  vi.mocked(sha256).mockReturnValue("digest-of-the-ciphertext");
});

test("the manifest extends the export manifest with the target kind, recipients, dump tool and PostgreSQL major", () => {
  expect(buildBackupManifest(input)).toEqual({
    version: 1,
    environment: "vps",
    createdAt: "2026-11-23T04:05:06.000Z",
    recipient: `${VPS},${RECOVERY}`,
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
    recipients: [VPS, RECOVERY],
    dump: { tool: "pg_dump", version: "18.1", postgresMajor: 17 },
  });
});

test("the digest is of the ciphertext, never of the plaintext dump, so a manifest verifies the stored object", () => {
  buildBackupManifest(input);
  expect(sha256).toHaveBeenCalledWith(CIPHER);
  expect(sha256).toHaveBeenCalledTimes(1);
});
