import { beforeEach, expect, test, vi } from "vitest";
import { buildBackupManifest, type BackupManifest } from "./backup-manifest.js";
import { backupObject, backupStamp } from "./backup-layout.js";
import { backupRecipients } from "./backup-recipients.js";
import { runBackup, type BackupDeps, type BackupJob } from "./backup-run.js";
import { ObjectExistsError } from "./backup-s3.js";

vi.mock("./backup-layout.js");
vi.mock("./backup-manifest.js");
vi.mock("./backup-recipients.js");

const NOW = new Date("2026-11-23T04:05:06.000Z");
const RECIPIENTS = ["age1vps", "age1recovery"];
const OBJECT = "vps/golden-path/pg-main/app/2026-11-23T04-05-06Z.sql.age";
const MANIFEST = `${OBJECT}.manifest.json`;
const HEADER = { postgresMajor: 17, dumpVersion: "18.1" };
/** What buildBackupManifest returns: its JSON is what the manifest object holds. */
const BUILT = { built: "manifest" } as unknown as BackupManifest;

const job: BackupJob = {
  environment: "vps",
  namespace: "golden-path",
  cluster: "pg-main",
  database: "app",
  kind: "off-host",
  canary: false,
  recipients: RECIPIENTS,
  now: NOW,
};

/** Each collaborator writes its step to `log`, so a test can assert the order of effects. */
function deps(log: string[]): BackupDeps {
  return {
    dump: vi.fn(async (database: string) => {
      log.push(`dump:${database}`);
      return { plaintext: "PLAIN", header: HEADER };
    }),
    encrypt: vi.fn(async () => {
      log.push("encrypt");
      return "CIPHER";
    }),
    store: {
      put: vi.fn(async (key: string) => {
        log.push(`put:${key}`);
      }),
    },
  };
}

beforeEach(() => {
  vi.mocked(backupStamp).mockReturnValue("2026-11-23T04-05-06Z");
  vi.mocked(backupObject).mockReturnValue({
    object: OBJECT,
    file: "2026-11-23T04-05-06Z.sql.age",
    manifest: MANIFEST,
  });
  vi.mocked(backupRecipients).mockReturnValue(RECIPIENTS);
  vi.mocked(buildBackupManifest).mockReturnValue(BUILT);
});

test("a backup dumps, encrypts, stores the object, and only then stores its manifest beside it", async () => {
  const log: string[] = [];
  const outcome = await runBackup(deps(log), job);
  expect(log).toEqual([
    "dump:app",
    "encrypt",
    `put:${OBJECT}`,
    `put:${MANIFEST}`,
  ]);
  expect(outcome).toEqual({ object: OBJECT, manifest: MANIFEST });
});

test("only the ciphertext is ever stored, and the manifest is built from the stored bytes and the dump header", async () => {
  const collaborators = deps([]);
  await runBackup(collaborators, job);
  expect(collaborators.store.put).toHaveBeenNthCalledWith(
    1,
    OBJECT,
    Buffer.from("CIPHER"),
    "application/octet-stream",
  );
  expect(collaborators.store.put).toHaveBeenNthCalledWith(
    2,
    MANIFEST,
    Buffer.from(`${JSON.stringify(BUILT, null, 2)}\n`),
    "application/json",
  );
  expect(buildBackupManifest).toHaveBeenCalledWith(
    expect.objectContaining({
      environment: "vps",
      createdAt: "2026-11-23T04:05:06.000Z",
      file: "2026-11-23T04-05-06Z.sql.age",
      ciphertext: "CIPHER",
      kind: "off-host",
      recipients: RECIPIENTS,
      header: HEADER,
    }),
  );
});

test("the recipients and the object name are checked before any dump, so a bad config touches nothing", async () => {
  vi.mocked(backupRecipients).mockImplementation(() => {
    throw new Error("a backup lists exactly two recipients");
  });
  const log: string[] = [];
  await expect(runBackup(deps(log), job)).rejects.toThrow(
    "a backup lists exactly two recipients",
  );
  expect(log).toEqual([]);
});

test("a failed dump fails the run, and nothing is encrypted or stored", async () => {
  const log: string[] = [];
  const collaborators = deps(log);
  vi.mocked(collaborators.dump).mockRejectedValue(
    new Error("pg_dump exited 1"),
  );
  await expect(runBackup(collaborators, job)).rejects.toThrow(
    "pg_dump exited 1",
  );
  expect(log).toEqual([]);
});

test("a failed encryption fails the run, and no plaintext or ciphertext is stored", async () => {
  const log: string[] = [];
  const collaborators = deps(log);
  vi.mocked(collaborators.encrypt).mockRejectedValue(new Error("age failed"));
  await expect(runBackup(collaborators, job)).rejects.toThrow("age failed");
  expect(log).toEqual(["dump:app"]);
});

test("an object that already exists is refused: the run fails and its manifest is never written", async () => {
  const log: string[] = [];
  const collaborators = deps(log);
  vi.mocked(collaborators.store.put).mockImplementation(async (key) => {
    log.push(`put:${key}`);
    throw new ObjectExistsError(key, "backups");
  });
  await expect(runBackup(collaborators, job)).rejects.toBeInstanceOf(
    ObjectExistsError,
  );
  expect(log).toEqual(["dump:app", "encrypt", `put:${OBJECT}`]);
});

test("a failed manifest write fails the run, so no success is reported for an object with no manifest", async () => {
  const log: string[] = [];
  const collaborators = deps(log);
  vi.mocked(collaborators.store.put).mockImplementation(async (key) => {
    log.push(`put:${key}`);
    if (key === MANIFEST) {
      throw new Error("manifest write refused");
    }
  });
  await expect(runBackup(collaborators, job)).rejects.toThrow(
    "manifest write refused",
  );
});
