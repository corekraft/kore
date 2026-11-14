import { createHash, type Hash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import {
  assertExportFileName,
  exportDirectory,
  hasVerifiedExport,
  MANIFEST_SUFFIX,
  newestVerifiedExport,
  sha256,
  verifyManifest,
} from "./export-manifest.js";
import { fakeRepository } from "./cluster-support.js";

vi.mock("node:crypto");
vi.mock("node:fs/promises");
vi.mock("node:path");

const DIRECTORY = "/repo/.kore/exports/local";
const repository = fakeRepository();

/** A digest whose value is the bytes it was fed, so a match means the bytes match. */
function fakeHash(): Hash {
  let input = "";
  const hash = {
    update: vi.fn((data: string | Buffer) => {
      input = String(data);
      return hash;
    }),
    digest: vi.fn(() => `hash:${input}`),
  };
  return hash as unknown as Hash;
}

function manifestText(
  overrides: Record<string, unknown> = {},
  artifact: { file?: string; sha256?: string; bytes?: number } = {},
): string {
  return JSON.stringify({
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
    artifact: {
      file: "pg-main.sql.age",
      sha256: "hash:cipher",
      bytes: 6,
      ...artifact,
    },
    ...overrides,
  });
}

/** A file system where only the listed paths exist; every other path is missing. */
function files(map: Record<string, string | Buffer>) {
  return async (path: unknown) => {
    const key = String(path);
    if (!(key in map)) {
      throw Object.assign(new Error(`ENOENT: ${key}`), { code: "ENOENT" });
    }
    return map[key];
  };
}

beforeEach(() => {
  vi.mocked(createHash).mockImplementation(() => fakeHash());
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(basename).mockImplementation(
    (path: string) => path.split("/").pop() ?? "",
  );
});

test("the manifest suffix names the manifest beside an artifact", () => {
  expect(MANIFEST_SUFFIX).toBe(".manifest.json");
});

test("exports live in the environment's directory under .kore/exports", () => {
  expect(exportDirectory(repository)).toBe(DIRECTORY);
  expect(join).toHaveBeenCalledWith("/repo", ".kore", "exports", "local");
});

test("a digest is sha256 of the bytes it is given, whether text or a buffer", () => {
  expect(sha256("x")).toBe("hash:x");
  expect(sha256(Buffer.from("x"))).toBe("hash:x");
  expect(createHash).toHaveBeenCalledWith("sha256");
});

test("an export name must be a plain file name, so it cannot escape the export directory", () => {
  for (const name of ["", "../secrets.age", ".hidden.age", "dir/x.age"]) {
    expect(() => assertExportFileName(name)).toThrow(
      /--from must be a file name inside/,
    );
  }
  expect(() => assertExportFileName("pg-main.sql.age")).not.toThrow();
});

test("a manifest verifies when its artifact matches the recorded digest and size", async () => {
  vi.mocked(readFile).mockImplementation(
    files({
      [`${DIRECTORY}/pg-main.sql.age.manifest.json`]: manifestText(),
      [`${DIRECTORY}/pg-main.sql.age`]: Buffer.from("cipher"),
    }) as never,
  );
  const verified = await verifyManifest(
    repository,
    "pg-main.sql.age.manifest.json",
  );
  expect(verified?.artifact).toBe("cipher");
  expect(verified?.manifest.artifact.file).toBe("pg-main.sql.age");
  expect(readFile).toHaveBeenCalledTimes(2);
});

test("a manifest does not verify when the artifact's digest has changed", async () => {
  vi.mocked(readFile).mockImplementation(
    files({
      [`${DIRECTORY}/m.manifest.json`]: manifestText(),
      [`${DIRECTORY}/pg-main.sql.age`]: Buffer.from("TAMPERED"),
    }) as never,
  );
  expect(await verifyManifest(repository, "m.manifest.json")).toBeUndefined();
});

test("a manifest does not verify when the artifact's size differs, even with a matching digest", async () => {
  vi.mocked(readFile).mockImplementation(
    files({
      [`${DIRECTORY}/m.manifest.json`]: manifestText({}, { bytes: 99 }),
      [`${DIRECTORY}/pg-main.sql.age`]: Buffer.from("cipher"),
    }) as never,
  );
  expect(await verifyManifest(repository, "m.manifest.json")).toBeUndefined();
});

test("a manifest recorded for another environment does not verify this one, and its artifact is never read", async () => {
  vi.mocked(readFile).mockImplementation(
    files({
      [`${DIRECTORY}/m.manifest.json`]: manifestText({
        environment: "staging",
      }),
    }) as never,
  );
  expect(await verifyManifest(repository, "m.manifest.json")).toBeUndefined();
  expect(readFile).toHaveBeenCalledTimes(1);
});

test("an artifact name that is not a plain file name never verifies, and its path is never read", async () => {
  vi.mocked(readFile).mockImplementation(
    files({
      [`${DIRECTORY}/m.manifest.json`]: manifestText({}, { file: "../x.age" }),
    }) as never,
  );
  expect(await verifyManifest(repository, "m.manifest.json")).toBeUndefined();
  expect(readFile).toHaveBeenCalledTimes(1);
});

test("malformed or incomplete manifests never verify", async () => {
  for (const text of [
    "not json",
    JSON.stringify({ version: 1 }),
    manifestText({ version: 2 }),
  ]) {
    vi.mocked(readFile).mockImplementation(
      files({ [`${DIRECTORY}/m.manifest.json`]: text }) as never,
    );
    expect(await verifyManifest(repository, "m.manifest.json")).toBeUndefined();
  }
});

test("a manifest whose recorded digest is uppercase still verifies against the lowercase digest", async () => {
  vi.mocked(readFile).mockImplementation(
    files({
      [`${DIRECTORY}/m.manifest.json`]: manifestText(
        {},
        { sha256: "HASH:CIPHER" },
      ),
      [`${DIRECTORY}/pg-main.sql.age`]: Buffer.from("cipher"),
    }) as never,
  );
  expect(await verifyManifest(repository, "m.manifest.json")).toBeDefined();
});

test("a manifest that cannot be read does not verify and does not throw", async () => {
  vi.mocked(readFile).mockRejectedValue(new Error("EACCES"));
  expect(await verifyManifest(repository, "m.manifest.json")).toBeUndefined();
});

test("an export directory that cannot be listed holds no verified export", async () => {
  vi.mocked(readdir).mockRejectedValue(new Error("ENOENT"));
  expect(await hasVerifiedExport(repository)).toBe(false);
  expect(await newestVerifiedExport(repository)).toBeUndefined();
});

test("only manifests are considered, and one verified manifest is enough", async () => {
  vi.mocked(readdir).mockResolvedValue([
    "a.sql.age",
    "m.manifest.json",
  ] as never);
  vi.mocked(readFile).mockImplementation(
    files({
      [`${DIRECTORY}/m.manifest.json`]: manifestText(),
      [`${DIRECTORY}/pg-main.sql.age`]: Buffer.from("cipher"),
    }) as never,
  );
  expect(await hasVerifiedExport(repository)).toBe(true);
  expect(readFile).not.toHaveBeenCalledWith(`${DIRECTORY}/a.sql.age`, "utf8");
});

test("a directory of only unverified manifests holds no verified export", async () => {
  vi.mocked(readdir).mockResolvedValue(["invalid.manifest.json"] as never);
  vi.mocked(readFile).mockImplementation(
    files({ [`${DIRECTORY}/invalid.manifest.json`]: "not json" }) as never,
  );
  expect(await hasVerifiedExport(repository)).toBe(false);
});

test("the newest verified export is the latest creation time, and tampered or unparseable dates are ignored", async () => {
  vi.mocked(readdir).mockResolvedValue([
    "old.manifest.json",
    "new.manifest.json",
    "tampered.manifest.json",
    "dateless.manifest.json",
  ] as never);
  const artifactBytes = Buffer.from("cipher");
  vi.mocked(readFile).mockImplementation(
    files({
      [`${DIRECTORY}/old.manifest.json`]: manifestText(
        { createdAt: "2026-01-01T00:00:00.000Z" },
        { file: "old.age" },
      ),
      [`${DIRECTORY}/new.manifest.json`]: manifestText(
        { createdAt: "2026-11-01T00:00:00.000Z" },
        { file: "new.age" },
      ),
      [`${DIRECTORY}/tampered.manifest.json`]: manifestText(
        { createdAt: "2026-12-01T00:00:00.000Z" },
        { file: "t.age", sha256: "hash:other" },
      ),
      [`${DIRECTORY}/dateless.manifest.json`]: manifestText(
        { createdAt: "not a date" },
        { file: "d.age" },
      ),
      [`${DIRECTORY}/old.age`]: artifactBytes,
      [`${DIRECTORY}/new.age`]: artifactBytes,
      [`${DIRECTORY}/t.age`]: Buffer.from("cipher"),
      [`${DIRECTORY}/d.age`]: artifactBytes,
    }) as never,
  );
  expect(await newestVerifiedExport(repository)).toEqual(
    new Date("2026-11-01T00:00:00.000Z"),
  );
});
