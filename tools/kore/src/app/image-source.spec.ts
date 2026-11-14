// Docs: docs/decisions/0015-local-signed-image-delivery.md
import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { isLocalProvider } from "../config/index.js";
import {
  assertReleaseAutomationImage,
  imageForApplication,
  loadImageLock,
} from "../images/index.js";
import { environmentStatePath } from "../runtime/index.js";
import { errno, fakeImage, fakeRepository } from "./app-support.js";
import {
  localSigner,
  lockedImageForStatus,
  resolveImage,
} from "./image-source.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("../config/index.js");
vi.mock("../images/index.js");
vi.mock("../runtime/index.js");

const root = "/repo";
const lock = { entries: {} } as never;
const localLock = ".kore/state/environments/local/local-images.lock.json";

beforeEach(() => {
  vi.mocked(isLocalProvider).mockReturnValue(true);
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(relative).mockImplementation((_from, to) => to);
  vi.mocked(environmentStatePath).mockReturnValue(localLock);
  vi.mocked(loadImageLock).mockResolvedValue(lock);
  vi.mocked(imageForApplication).mockImplementation((_lock, application) =>
    fakeImage(`signer-of-${application}`),
  );
  vi.mocked(access).mockRejectedValue(errno("ENOENT"));
});

test("the source-build signer is the local developer key and nothing else", () => {
  expect(localSigner).toBe("local-kore-key");
});

test("a source build is deployed on a local k3d environment when signed by the local key and verified with a public key", async () => {
  const image = fakeImage(localSigner);
  await expect(
    resolveImage(fakeRepository(), "reference", image, "/k.pub"),
  ).resolves.toBe(image);
  expect(loadImageLock).not.toHaveBeenCalled();
});

test("a source build on a managed environment is refused, naming the environment, the signer and the release path", async () => {
  vi.mocked(isLocalProvider).mockReturnValue(false);
  await expect(
    resolveImage(
      fakeRepository({ provider: "managed" }),
      "reference",
      fakeImage(localSigner),
      "/k.pub",
    ),
  ).rejects.toThrow(
    /source-built image is accepted only on a local k3d environment.*signed by local-kore-key.*got signer local-kore-key on provider managed.*kore app up --image-lock/s,
  );
});

test("a source build signed by a release identity is refused, since only the local key may be a source build", async () => {
  await expect(
    resolveImage(
      fakeRepository(),
      "reference",
      fakeImage("release@kore.dev"),
      "/k.pub",
    ),
  ).rejects.toThrow(/got signer release@kore.dev/);
});

test("a source build without a public key to verify it with is refused", async () => {
  await expect(
    resolveImage(
      fakeRepository(),
      "reference",
      fakeImage(localSigner),
      undefined,
    ),
  ).rejects.toThrow(/from kore local up/);
});

test("without an override the image is the release lock entry for the application, checked as release automation", async () => {
  const image = await resolveImage(
    fakeRepository(),
    "reference",
    undefined,
    undefined,
  );
  expect(loadImageLock).toHaveBeenCalledWith(root, undefined);
  expect(imageForApplication).toHaveBeenCalledWith(lock, "reference");
  expect(assertReleaseAutomationImage).toHaveBeenCalledWith("reference", image);
  expect(image).toEqual(fakeImage("signer-of-reference"));
});

test("an explicit lock path is the lock a release attaches, not the committed one", async () => {
  await resolveImage(
    fakeRepository(),
    "reference",
    undefined,
    undefined,
    "releases/x.lock.json",
  );
  expect(loadImageLock).toHaveBeenCalledWith(root, "releases/x.lock.json");
});

test("a lock entry that is not release automation is refused and the image is never returned", async () => {
  vi.mocked(assertReleaseAutomationImage).mockImplementation(() => {
    throw new Error("not release automation");
  });
  await expect(
    resolveImage(fakeRepository(), "reference", undefined, undefined),
  ).rejects.toThrow("not release automation");
});

test("app status compares against the local source-build lock when one has been recorded on a local cluster", async () => {
  vi.mocked(access).mockResolvedValue(undefined);
  await lockedImageForStatus(fakeRepository(), "reference");
  expect(access).toHaveBeenCalledWith(`${root}/${localLock}`);
  expect(loadImageLock).toHaveBeenCalledWith(root, localLock);
});

test("app status falls back to the release lock when no source build has been recorded", async () => {
  await lockedImageForStatus(fakeRepository(), "reference");
  expect(loadImageLock).toHaveBeenCalledWith(root, undefined);
});

test("app status never reads a local lock on a managed environment", async () => {
  vi.mocked(isLocalProvider).mockReturnValue(false);
  await lockedImageForStatus(
    fakeRepository({ provider: "managed" }),
    "reference",
  );
  expect(access).not.toHaveBeenCalled();
  expect(loadImageLock).toHaveBeenCalledWith(root, undefined);
});

test("app status reports a failure to read the local lock as absent, not as an error", async () => {
  vi.mocked(access).mockRejectedValue(errno("EACCES"));
  await expect(
    lockedImageForStatus(fakeRepository(), "reference"),
  ).resolves.toEqual(fakeImage("signer-of-reference"));
});
