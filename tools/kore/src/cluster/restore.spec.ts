import { beforeEach, expect, test, vi } from "vitest";
import { assertExpectedCluster } from "./cluster.js";
import { execArgs, retainedClusters } from "./export-cluster.js";
import {
  assertExportFileName,
  verifyManifest,
  type ExportManifest,
} from "./export-manifest.js";
import { restoreRetainedData, type RestoreOptions } from "./restore.js";
import { fakeRepository, fakeRunner, commandLines } from "./cluster-support.js";

vi.mock("./cluster.js");
vi.mock("./export-cluster.js");
vi.mock("./export-manifest.js");

const CIPHER = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n";
const PLAIN = "CREATE TABLE t (id int);\n";
const REPLACE_SCHEMA =
  "DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public AUTHORIZATION pg_database_owner;\nGRANT USAGE ON SCHEMA public TO PUBLIC;\n";
const LOAD = [
  "psql",
  "--dbname",
  "app",
  "-v",
  "ON_ERROR_STOP=1",
  "--single-transaction",
  "--file",
  "-",
];

const manifest: ExportManifest = {
  version: 1,
  environment: "local",
  createdAt: "2026-11-14T10:00:00.000Z",
  recipient: "age1x",
  contents: {
    kind: "cnpg-database",
    namespace: "reference",
    cluster: "pg-main",
    database: "app",
    format: "pg_dump-plain",
  },
  artifact: { file: "pg-main.sql.age", sha256: "d", bytes: CIPHER.length },
};

const repository = fakeRepository();
const base: RestoreOptions = {
  from: "pg-main.sql.age",
  identity: "/keys/me.txt",
  overwriteData: false,
  yes: false,
  env: {},
};
/** The same options with no identity flag, so SOPS_AGE_KEY_FILE or nothing supplies it. */
const withoutIdentity: RestoreOptions = {
  from: "pg-main.sql.age",
  overwriteData: false,
  yes: false,
};

const countsTables = (args: readonly string[]) =>
  args.some((arg) => arg.includes("information_schema.tables"));

/** The answers a restore gets: the target has `tables` tables and PLAIN decrypts. */
function restoreRunner(tables = "0") {
  return fakeRunner((command, args) => {
    if (command === "age") {
      return PLAIN;
    }
    return countsTables(args) ? `${tables}\n` : "";
  });
}

beforeEach(() => {
  vi.mocked(assertExportFileName).mockReturnValue(undefined);
  vi.mocked(verifyManifest).mockResolvedValue({ manifest, artifact: CIPHER });
  vi.mocked(retainedClusters).mockResolvedValue([
    { name: "pg-main", primary: "pg-main-1" },
  ]);
  vi.mocked(execArgs).mockImplementation(
    (_repo, _ns, _primary, _opts, command) => [...command],
  );
});

test("a verified export is decrypted with the identity and loaded into the primary of the matching cluster", async () => {
  const { runner, run } = restoreRunner();
  expect(await restoreRetainedData(repository, runner, base)).toEqual({
    restored: true,
    cluster: "pg-main",
    database: "app",
  });
  expect(run).toHaveBeenCalledWith(
    "age",
    ["--decrypt", "--identity", "/keys/me.txt"],
    { capture: true, input: CIPHER },
  );
  expect(execArgs).toHaveBeenCalledWith(
    repository,
    "reference",
    "pg-main-1",
    { stdin: true },
    LOAD,
  );
  expect(run).toHaveBeenLastCalledWith("kubectl", LOAD, {
    capture: true,
    input: PLAIN,
  });
});

test("the identity comes from SOPS_AGE_KEY_FILE when no flag is given", async () => {
  const { runner, run } = restoreRunner();
  await restoreRetainedData(repository, runner, {
    ...withoutIdentity,
    env: { SOPS_AGE_KEY_FILE: "/keys/sops.txt" },
  });
  expect(run).toHaveBeenCalledWith(
    "age",
    ["--decrypt", "--identity", "/keys/sops.txt"],
    expect.anything(),
  );
});

test("without any identity the restore names both ways to supply one, and runs nothing", async () => {
  const { runner, run } = restoreRunner();
  await expect(
    restoreRetainedData(repository, runner, {
      ...withoutIdentity,
      env: {},
    }),
  ).rejects.toThrow(
    "restore needs your age identity: pass --identity <path to your age key file> or set SOPS_AGE_KEY_FILE",
  );
  expect(run).not.toHaveBeenCalled();
});

test("an export name that escapes the export directory is refused before anything is read", async () => {
  vi.mocked(assertExportFileName).mockImplementation(() => {
    throw new Error("--from must be a file name inside");
  });
  const { runner, run } = restoreRunner();
  await expect(
    restoreRetainedData(repository, runner, { ...base, from: "../x.age" }),
  ).rejects.toThrow("--from must be a file name inside");
  expect(verifyManifest).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("an export that does not verify is refused before decrypting or touching the cluster", async () => {
  vi.mocked(verifyManifest).mockResolvedValue(undefined);
  const { runner, run } = restoreRunner();
  await expect(restoreRetainedData(repository, runner, base)).rejects.toThrow(
    "export pg-main.sql.age is missing, belongs to another environment, or does not match its manifest digest; re-export before restoring",
  );
  expect(assertExpectedCluster).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a verified manifest whose artifact is another file is refused, so one export cannot load as another", async () => {
  vi.mocked(verifyManifest).mockResolvedValue({
    manifest: {
      ...manifest,
      artifact: { ...manifest.artifact, file: "other.age" },
    },
    artifact: CIPHER,
  });
  const { runner, run } = restoreRunner();
  await expect(restoreRetainedData(repository, runner, base)).rejects.toThrow(
    "does not match its manifest digest",
  );
  expect(run).not.toHaveBeenCalled();
});

test("overwriting a database needs --yes, and is refused before the cluster is contacted", async () => {
  const { runner, run } = restoreRunner("3");
  await expect(
    restoreRetainedData(repository, runner, { ...base, overwriteData: true }),
  ).rejects.toThrow(
    "--overwrite-data replaces the existing database and requires --yes",
  );
  expect(assertExpectedCluster).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("a database that already has tables is left alone without --overwrite-data, and nothing is decrypted or loaded", async () => {
  const { runner, run } = restoreRunner("3");
  await expect(restoreRetainedData(repository, runner, base)).rejects.toThrow(
    "database app in pg-main is not empty (3 tables); restore targets a fresh profile. Repeat with --overwrite-data --yes to replace it",
  );
  expect(commandLines(run)).toEqual([
    expect.stringContaining("information_schema.tables"),
  ]);
});

test("overwriting a populated database drops and recreates public inside the same transaction as the load", async () => {
  const { runner, run } = restoreRunner("3");
  await restoreRetainedData(repository, runner, {
    ...base,
    overwriteData: true,
    yes: true,
  });
  expect(run).toHaveBeenLastCalledWith("kubectl", LOAD, {
    capture: true,
    input: `${REPLACE_SCHEMA}${PLAIN}`,
  });
});

test("the target cluster must exist in the namespace before anything is decrypted", async () => {
  vi.mocked(retainedClusters).mockResolvedValue([]);
  const { runner, run } = restoreRunner();
  await expect(restoreRetainedData(repository, runner, base)).rejects.toThrow(
    "cluster pg-main not found in namespace reference; bring the platform and reference app up first (kore local up)",
  );
  expect(run).not.toHaveBeenCalled();
});

test("a target cluster with no primary yet is not loaded into", async () => {
  vi.mocked(retainedClusters).mockResolvedValue([
    { name: "pg-main", primary: "" },
  ]);
  const { runner } = restoreRunner();
  await expect(restoreRetainedData(repository, runner, base)).rejects.toThrow(
    "cluster pg-main has no primary yet; wait until ready",
  );
});

test("a table count that is not a number refuses the restore with the output it read", async () => {
  const { runner } = fakeRunner((_command, args) =>
    countsTables(args) ? "psql: connection refused" : "",
  );
  await expect(restoreRetainedData(repository, runner, base)).rejects.toThrow(
    "could not read the table count of app in pg-main: psql: connection refused",
  );
});
