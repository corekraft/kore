import { beforeEach, expect, test, vi } from "vitest";
import { backupProgram } from "./backup-main.js";
import { backupConfigFromEnv } from "./backup-config.js";
import { runBackup } from "./backup-run.js";
import { s3ObjectStore } from "./backup-s3.js";
import { dumpDatabase, encryptDump } from "./backup-tools.js";
import { fakeRunner } from "./cluster-support.js";

vi.mock("./backup-config.js");
vi.mock("./backup-run.js");
vi.mock("./backup-s3.js");
vi.mock("./backup-tools.js");

const NOW = new Date("2026-11-23T04:05:06.000Z");
const RECIPIENTS = ["age1vps", "age1recovery"];
const TARGET = {
  endpoint: "https://s3.example.com",
  bucket: "backups",
  region: "eu-west-1",
  pathStyle: true,
};
const CREDENTIALS = { accessKeyId: "AK", secretAccessKey: "SK" };
const OUTCOME = {
  object: "vps/golden-path/pg-main/app/x.sql.age",
  manifest: "vps/golden-path/pg-main/app/x.sql.age.manifest.json",
};

const argv = [
  "--environment",
  "vps",
  "--namespace",
  "golden-path",
  "--cluster",
  "pg-main",
  "--database",
  "app",
  "--recipient",
  "age1vps",
  "--recipient",
  "age1recovery",
];

const withoutCluster = [
  "--environment",
  "vps",
  "--namespace",
  "golden-path",
  "--database",
  "app",
  "--recipient",
  "age1vps",
  "--recipient",
  "age1recovery",
];

function program(args: readonly string[] = argv) {
  const { runner } = fakeRunner();
  return backupProgram({ argv: args, env: {}, runner, now: NOW });
}

beforeEach(() => {
  vi.mocked(backupConfigFromEnv).mockReturnValue({
    target: TARGET,
    credentials: CREDENTIALS,
    kind: "interim",
  });
  vi.mocked(s3ObjectStore).mockReturnValue({ put: vi.fn() });
  vi.mocked(runBackup).mockResolvedValue(OUTCOME);
});

test("a real-data backup runs with the job's names, the configured kind, and its two recipients", async () => {
  await expect(program()).resolves.toEqual(OUTCOME);
  expect(vi.mocked(runBackup).mock.calls[0]?.[1]).toEqual({
    environment: "vps",
    namespace: "golden-path",
    cluster: "pg-main",
    database: "app",
    kind: "interim",
    canary: false,
    recipients: RECIPIENTS,
    now: NOW,
  });
});

test("a canary backup is marked as one and carries the drill-only recipient", async () => {
  await program([...argv, "--canary", "--drill-recipient", "age1drill"]);
  expect(vi.mocked(runBackup).mock.calls[0]?.[1]).toMatchObject({
    canary: true,
    drillRecipient: "age1drill",
  });
});

test("the object store is the S3 target from the environment, with its write credential", async () => {
  await program();
  expect(s3ObjectStore).toHaveBeenCalledWith({
    target: TARGET,
    credentials: CREDENTIALS,
  });
});

test("the dump and the encryption are the pg_dump and age adapters over the runner", async () => {
  const header = { postgresMajor: 17, dumpVersion: "18.1" };
  vi.mocked(dumpDatabase).mockResolvedValue({ plaintext: "DUMP", header });
  vi.mocked(encryptDump).mockResolvedValue("CIPHER");
  await program();
  const deps = vi.mocked(runBackup).mock.calls[0]?.[0];
  await expect(deps?.dump("app")).resolves.toEqual({
    plaintext: "DUMP",
    header,
  });
  await expect(deps?.encrypt(RECIPIENTS, "DUMP")).resolves.toBe("CIPHER");
  expect(dumpDatabase).toHaveBeenCalledWith(expect.anything(), "app");
  expect(encryptDump).toHaveBeenCalledWith(
    expect.anything(),
    RECIPIENTS,
    "DUMP",
  );
});

test("a missing name is refused by its flag, and nothing is dumped", async () => {
  await expect(program(withoutCluster)).rejects.toThrow(
    "--cluster is required",
  );
  expect(runBackup).not.toHaveBeenCalled();
});

test("a bad target stops the run before anything is dumped, and the config error is what is reported", async () => {
  vi.mocked(backupConfigFromEnv).mockImplementation(() => {
    throw new Error("KORE_BACKUP_KIND must be interim or off-host");
  });
  await expect(program()).rejects.toThrow(
    "KORE_BACKUP_KIND must be interim or off-host",
  );
  expect(runBackup).not.toHaveBeenCalled();
});

test("an unknown flag is refused rather than ignored", async () => {
  await expect(program([...argv, "--purge"])).rejects.toThrow(/Unknown option/);
});
