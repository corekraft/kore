import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { assertExpectedCluster } from "./cluster.js";
import { exportRetainedData } from "./export.js";
import { execArgs, retainedClusters } from "./export-cluster.js";
import { exportDirectory, sha256 } from "./export-manifest.js";
import { exportRecipient } from "./export-recipient.js";
import { fakeRepository, fakeRunner } from "./cluster-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("./cluster.js");
vi.mock("./export-cluster.js");
vi.mock("./export-manifest.js");
vi.mock("./export-recipient.js");

const RECIPIENT = `age1${"q".repeat(58)}`;
const PLAIN = "CREATE TABLE t (id int);\n";
const CIPHER = "-----BEGIN AGE ENCRYPTED FILE-----\nabc\n";
const NOW = new Date("2026-11-14T10:00:00.000Z");
const ARTIFACT = "pg-main-2026-11-14T10-00-00Z.sql.age";
const DIRECTORY = "/repo/.kore/exports/local";
const repository = fakeRepository();
const options = { namespace: "reference", now: () => NOW };

/** kubectl answers the pvc query with `uncovered`; pg_dump yields PLAIN; age yields CIPHER. */
function reply(uncovered = "") {
  return (command: string, args: readonly string[]) => {
    if (command === "age") {
      return CIPHER;
    }
    if (args.includes("pg_dump-exec")) {
      return PLAIN;
    }
    return args.includes("pvc") ? uncovered : "";
  };
}

beforeEach(() => {
  vi.mocked(exportRecipient).mockResolvedValue(RECIPIENT);
  vi.mocked(retainedClusters).mockResolvedValue([
    { name: "pg-main", primary: "pg-main-1" },
  ]);
  vi.mocked(execArgs).mockImplementation(
    (_repo, _ns, primary, _opts, command) =>
      primary === "pg-main-1" ? ["pg_dump-exec", ...command] : ["other"],
  );
  vi.mocked(exportDirectory).mockReturnValue(DIRECTORY);
  vi.mocked(sha256).mockReturnValue("sha-of-cipher");
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

test("each retained database is dumped from its primary and the dump is encrypted to the configured recipient", async () => {
  const { runner, run } = fakeRunner(reply());
  await exportRetainedData(repository, runner, options);
  expect(execArgs).toHaveBeenCalledWith(
    repository,
    "reference",
    "pg-main-1",
    { stdin: false },
    ["pg_dump", "--dbname=app", "--format=plain"],
  );
  expect(run).toHaveBeenCalledWith(
    "age",
    ["--armor", "--recipient", RECIPIENT],
    { capture: true, input: PLAIN },
  );
});

test("the artifact is written with a stamped name, owner-only mode, and no overwrite", async () => {
  const { runner } = fakeRunner(reply());
  await exportRetainedData(repository, runner, options);
  expect(writeFile).toHaveBeenCalledWith(`${DIRECTORY}/${ARTIFACT}`, CIPHER, {
    mode: 0o600,
    flag: "wx",
  });
  expect(mkdir).toHaveBeenCalledWith(DIRECTORY, {
    recursive: true,
    mode: 0o700,
  });
});

test("the manifest is written after the artifact and records the digest, size, contents and recipient", async () => {
  const { runner } = fakeRunner(reply());
  await exportRetainedData(repository, runner, options);
  const [artifactCall, manifestCall] = vi.mocked(writeFile).mock.calls;
  expect(artifactCall?.[0]).toBe(`${DIRECTORY}/${ARTIFACT}`);
  expect(manifestCall?.[0]).toBe(`${DIRECTORY}/${ARTIFACT}.manifest.json`);
  expect(JSON.parse(manifestCall?.[1] as string)).toEqual({
    version: 1,
    environment: "local",
    createdAt: NOW.toISOString(),
    recipient: RECIPIENT,
    contents: {
      kind: "cnpg-database",
      namespace: "reference",
      cluster: "pg-main",
      database: "app",
      format: "pg_dump-plain",
    },
    artifact: {
      file: ARTIFACT,
      sha256: "sha-of-cipher",
      bytes: Buffer.byteLength(CIPHER),
    },
  });
  expect(manifestCall?.[2]).toEqual({ mode: 0o600, flag: "wx" });
  expect(sha256).toHaveBeenCalledWith(CIPHER);
});

test("the export result lists one entry per cluster with its artifact, manifest and digest", async () => {
  const { runner } = fakeRunner(reply());
  expect(await exportRetainedData(repository, runner, options)).toEqual({
    exports: [
      {
        artifact: ARTIFACT,
        manifest: `${ARTIFACT}.manifest.json`,
        sha256: "sha-of-cipher",
        cluster: "pg-main",
      },
    ],
  });
});

test("plaintext is never written to disk, only the ciphertext and the manifest", async () => {
  const { runner } = fakeRunner(reply());
  await exportRetainedData(repository, runner, options);
  const written = vi
    .mocked(writeFile)
    .mock.calls.map((call) => call[1] as string);
  expect(written.join("")).not.toContain("CREATE TABLE");
  expect(written).toEqual([CIPHER, expect.stringContaining('"version": 1')]);
});

test("the recipient is checked before the cluster is contacted, so a bad recipient runs no command", async () => {
  vi.mocked(exportRecipient).mockRejectedValue(new Error("placeholder"));
  const { runner, run } = fakeRunner(reply());
  await expect(exportRetainedData(repository, runner, options)).rejects.toThrow(
    "placeholder",
  );
  expect(assertExpectedCluster).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("an export with no retained database fails before anything is dumped or written", async () => {
  vi.mocked(retainedClusters).mockResolvedValue([]);
  const { runner, run } = fakeRunner(reply());
  await expect(exportRetainedData(repository, runner, options)).rejects.toThrow(
    "no retained CloudNativePG cluster found in namespace reference; nothing to export",
  );
  expect(run).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
});

test("retained volumes outside a CloudNativePG cluster stop the export, since pg_dump would be partial", async () => {
  const { runner, run } = fakeRunner(reply("persistentvolumeclaim/scratch\n"));
  await expect(exportRetainedData(repository, runner, options)).rejects.toThrow(
    /retained volumes outside a CloudNativePG cluster cannot be exported yet:\npersistentvolumeclaim\/scratch/,
  );
  expect(run.mock.calls.some(([, args]) => args.includes("pg_dump-exec"))).toBe(
    false,
  );
  expect(writeFile).not.toHaveBeenCalled();
});

test("a cluster with no primary yet is not exported", async () => {
  vi.mocked(retainedClusters).mockResolvedValue([
    { name: "pg-main", primary: "" },
  ]);
  const { runner } = fakeRunner(reply());
  await expect(exportRetainedData(repository, runner, options)).rejects.toThrow(
    "cluster pg-main has no primary yet; wait until it is ready, then export",
  );
});

test("an encryption failure writes no artifact and no manifest, and removes nothing it did not create", async () => {
  const { runner } = fakeRunner((command, args) => {
    if (command === "age") {
      throw new Error("age: boom");
    }
    return args.includes("pg_dump-exec") ? PLAIN : "";
  });
  await expect(exportRetainedData(repository, runner, options)).rejects.toThrow(
    "age: boom",
  );
  expect(writeFile).not.toHaveBeenCalled();
  expect(rm).not.toHaveBeenCalled();
});

test("a manifest that cannot be written removes the artifact it just wrote, then rethrows", async () => {
  vi.mocked(writeFile)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("disk full"));
  const { runner } = fakeRunner(reply());
  await expect(exportRetainedData(repository, runner, options)).rejects.toThrow(
    "disk full",
  );
  expect(rm).toHaveBeenCalledWith(`${DIRECTORY}/${ARTIFACT}`, { force: true });
});
