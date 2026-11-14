import { expect, test, vi, beforeEach } from "vitest";
import { relative, resolve } from "node:path";
import { imageLockFlag } from "./image-lock-flag.js";
import { parsedArgs } from "./cli-support.js";

vi.mock("node:path");

const root = "/repo/kore";

beforeEach(() => {
  vi.mocked(resolve).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(relative).mockImplementation((_from, to) => `relative:${to}`);
});

test("without --image-lock the flag resolves to nothing and touches no path", () => {
  expect(imageLockFlag(parsedArgs(), root)).toBeUndefined();
  expect(resolve).not.toHaveBeenCalled();
  expect(relative).not.toHaveBeenCalled();
});

test("an absolute --image-lock is resolved against the root, then made root-relative for the loader", () => {
  const flag = parsedArgs({
    "image-lock": "/tmp/release/images.lock.json",
  });
  expect(imageLockFlag(flag, root)).toBe(
    "relative:/repo/kore//tmp/release/images.lock.json",
  );
  expect(resolve).toHaveBeenCalledWith(root, "/tmp/release/images.lock.json");
  expect(relative).toHaveBeenCalledWith(
    root,
    "/repo/kore//tmp/release/images.lock.json",
  );
});

test("a relative --image-lock is taken from the repository root", () => {
  const flag = parsedArgs({ "image-lock": "release/images.lock.json" });
  expect(imageLockFlag(flag, root)).toBe(
    "relative:/repo/kore/release/images.lock.json",
  );
  expect(resolve).toHaveBeenCalledWith(root, "release/images.lock.json");
});

test("--image-lock without a file is refused with the usage, before any path is resolved", () => {
  expect(() => imageLockFlag(parsedArgs({ "image-lock": true }), root)).toThrow(
    "--image-lock requires a file: the images.lock.json attached to a release",
  );
  expect(resolve).not.toHaveBeenCalled();
});
