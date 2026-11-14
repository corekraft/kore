// Docs: docs/decisions/0015-local-signed-image-delivery.md
import { beforeEach, expect, test, vi } from "vitest";
import { converge } from "./converge.js";
import { fakeImage, fakeRepository, fakeRunner } from "./app-support.js";
import { resolveImage } from "./image-source.js";
import { appUp, appUpRelease } from "./up.js";

vi.mock("./converge.js");
vi.mock("./image-source.js");

const name = "reference";
const repository = fakeRepository();
const publicKey = "/k.pub";

beforeEach(() => {
  vi.mocked(resolveImage).mockResolvedValue(fakeImage());
  vi.mocked(converge).mockResolvedValue();
});

test("a release deploys the image its lock entry names, converging on exactly that image and the given options", async () => {
  const { runner } = fakeRunner();
  const resolved = fakeImage("release@kore.dev");
  vi.mocked(resolveImage).mockResolvedValue(resolved);
  await appUpRelease(repository, runner, name, "releases/x.lock.json", {
    publicKey,
  });
  expect(resolveImage).toHaveBeenCalledWith(
    repository,
    name,
    undefined,
    publicKey,
    "releases/x.lock.json",
  );
  expect(converge).toHaveBeenCalledWith(repository, runner, name, resolved, {
    publicKey,
  });
});

test("a release without a lock path resolves from the committed lock", async () => {
  const { runner } = fakeRunner();
  await appUpRelease(repository, runner, name);
  expect(resolveImage).toHaveBeenCalledWith(
    repository,
    name,
    undefined,
    undefined,
    undefined,
  );
  expect(converge).toHaveBeenCalledWith(
    repository,
    runner,
    name,
    fakeImage(),
    {},
  );
});

test("a source build from kore local up is passed to image resolution as the override, never looked up in a lock", async () => {
  const { runner } = fakeRunner();
  const build = fakeImage("local-kore-key");
  await appUp(repository, runner, name, build, { publicKey });
  expect(resolveImage).toHaveBeenCalledWith(repository, name, build, publicKey);
  expect(converge).toHaveBeenCalledWith(repository, runner, name, fakeImage(), {
    publicKey,
  });
});

test("an app up without an override resolves its image from the release lock", async () => {
  const { runner } = fakeRunner();
  await appUp(repository, runner, name);
  expect(resolveImage).toHaveBeenCalledWith(
    repository,
    name,
    undefined,
    undefined,
  );
});

test("an image that resolution refuses never reaches the cluster: converge is not called", async () => {
  vi.mocked(resolveImage).mockRejectedValue(
    new Error("not release automation"),
  );
  const { runner, run } = fakeRunner();
  await expect(appUp(repository, runner, name)).rejects.toThrow(
    "not release automation",
  );
  expect(converge).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("up starts no process itself: it hands the runner to convergence and never calls it", async () => {
  const { runner, run } = fakeRunner();
  await appUpRelease(repository, runner, name);
  await appUp(repository, runner, name);
  expect(run).not.toHaveBeenCalled();
  expect(converge).toHaveBeenCalledTimes(2);
});
