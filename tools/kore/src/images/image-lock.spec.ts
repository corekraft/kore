import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import {
  imageForApplication,
  loadImageLock,
  type ImageLock,
} from "./image-lock.js";

vi.mock("node:fs/promises");
vi.mock("node:path");

const lockPath = "/repo/infra/catalog/images.lock.json";
const signer = "release@kore.dev";
const digest = "sha256:" + "a".repeat(64);

/** The lock file text: one valid entry, with its fields overridable. */
function lockWith(
  entry: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    version: 1,
    authorizedSigners: [signer],
    entries: {
      reference: {
        image: "registry.kore.local/reference",
        digest,
        signer,
        ...entry,
      },
    },
    ...overrides,
  });
}

beforeEach(() => {
  vi.mocked(join).mockReturnValue(lockPath);
});

test("loads the default lock from the repository root and resolves a locked application to its digest reference", async () => {
  vi.mocked(readFile).mockResolvedValue(lockWith());

  const lock = await loadImageLock("/repo");

  expect(join).toHaveBeenCalledWith("/repo", "infra/catalog/images.lock.json");
  expect(readFile).toHaveBeenCalledWith(lockPath, "utf8");
  expect(imageForApplication(lock, "reference")).toEqual({
    reference: `registry.kore.local/reference@${digest}`,
    digest,
    signer,
  });
});

test("accepts an internal image on a registry exposed on an explicit port", async () => {
  vi.mocked(readFile).mockResolvedValue(
    lockWith({ image: "registry.kore.local:30500/reference" }),
  );
  await expect(
    loadImageLock("/repo", "images.lock.json"),
  ).resolves.toBeTruthy();
});

test("reports the required location when the lock file cannot be read", async () => {
  vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

  await expect(loadImageLock("/repo")).rejects.toThrow(
    `image lock is required at ${lockPath}`,
  );
});

test.each([
  [
    "a tag on the internal image",
    { image: "registry.kore.local/reference:latest" },
    /must use an internal image without a tag/,
  ],
  ["no signer", { signer: "" }, /has no signer/],
  ["a malformed digest", { digest: "sha256:bad" }, /invalid digest/],
  [
    "a signer outside the authorized list",
    { signer: "developer@kore.dev" },
    /unauthorized signer/,
  ],
])("rejects a lock entry with %s", async (_case, entry, message) => {
  vi.mocked(readFile).mockResolvedValue(lockWith(entry));

  await expect(loadImageLock("/repo")).rejects.toThrow(message);
});

test.each([
  ["a lock that is not an object", "null", /must be an object/],
  [
    "a lock at another version",
    lockWith({}, { version: 2 }),
    /version 1, authorized signers, and entries/,
  ],
  [
    "a lock with no authorized signers",
    lockWith({}, { authorizedSigners: [] }),
    /version 1, authorized signers, and entries/,
  ],
  [
    "an application name that is not lowercase",
    JSON.stringify({
      version: 1,
      authorizedSigners: [signer],
      entries: { Bad_Name: {} },
    }),
    /invalid entry for Bad_Name/,
  ],
  [
    "an image reference with no repository path",
    lockWith({ image: "reference" }),
    /must use an internal image without a tag/,
  ],
])("rejects a lock file with %s", async (_case, contents, message) => {
  vi.mocked(readFile).mockResolvedValue(contents);

  await expect(loadImageLock("/repo")).rejects.toThrow(message);
});

test("refuses an application that has no locked image", () => {
  const lock: ImageLock = {
    version: 1,
    authorizedSigners: [signer],
    entries: {},
  };

  expect(() => imageForApplication(lock, "reference")).toThrow(
    /no locked image for application reference/,
  );
});
