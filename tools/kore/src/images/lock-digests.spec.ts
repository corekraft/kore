import { access } from "node:fs/promises";
import { beforeEach, expect, it, vi } from "vitest";
import type { Repository } from "../config/index.js";
import { environmentStatePath } from "../runtime/index.js";
import { loadImageLock, type ImageLock } from "./image-lock.js";
import { lockedDigests } from "./lock-digests.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

vi.mock("node:fs/promises");
vi.mock("../runtime/index.js");
vi.mock("./image-lock.js");

const repository = {
  root: "/repo",
  environment: { name: "local" },
} as Repository;
const lock = (...digests: string[]): ImageLock => ({
  version: 1,
  authorizedSigners: ["s"],
  entries: Object.fromEntries(
    digests.map((digest, index) => [
      `app${index}`,
      { image: "r/x", digest, signer: "s" },
    ]),
  ),
});

beforeEach(() => {
  vi.mocked(environmentStatePath).mockReturnValue("/state/local.lock.json");
});

it("collects the digests of the catalog lock and of this environment's local lock", async () => {
  vi.mocked(access).mockResolvedValue();
  vi.mocked(loadImageLock).mockImplementation(async (_root, path) =>
    path === undefined ? lock("sha256:a") : lock("sha256:b", "sha256:c"),
  );
  expect(await lockedDigests(repository)).toEqual(
    new Set(["sha256:a", "sha256:b", "sha256:c"]),
  );
  expect(loadImageLock).toHaveBeenCalledWith("/", "/state/local.lock.json");
});

it("reads only the catalog lock when no local lock exists yet", async () => {
  vi.mocked(access).mockRejectedValue(
    Object.assign(new Error("gone"), { code: "ENOENT" }),
  );
  vi.mocked(loadImageLock).mockResolvedValue(lock("sha256:a"));
  expect(await lockedDigests(repository)).toEqual(new Set(["sha256:a"]));
  expect(loadImageLock).toHaveBeenCalledTimes(1);
});

it("fails, rather than spare nothing, when a lock exists but is unreadable", async () => {
  vi.mocked(access).mockResolvedValue();
  vi.mocked(loadImageLock).mockRejectedValue(new Error("bad lock"));
  await expect(lockedDigests(repository)).rejects.toThrow("bad lock");
});

it("rethrows an access error that is not a missing file", async () => {
  vi.mocked(access).mockRejectedValue(
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  vi.mocked(loadImageLock).mockResolvedValue(lock());
  await expect(lockedDigests(repository)).rejects.toThrow("denied");
});
