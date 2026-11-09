import { expect, test } from "vitest";
import { imageLockFlag } from "./image-lock-flag.js";
import { parseArgs } from "./flags.js";

const root = "/repo/kore";
const flag = (...args: string[]) => imageLockFlag(parseArgs(args), root);

test("no --image-lock keeps the committed lock", () => {
  expect(flag("reference")).toBeUndefined();
});

test("an absolute --image-lock becomes the root-relative path the loader joins", () => {
  expect(flag("--image-lock", "/tmp/release/images.lock.json")).toBe(
    "../../tmp/release/images.lock.json",
  );
});

test("a relative --image-lock is taken from the repository root", () => {
  expect(flag("--image-lock=release/images.lock.json")).toBe(
    "release/images.lock.json",
  );
});

test("--image-lock without a file is refused with the usage", () => {
  expect(() => flag("--image-lock")).toThrow(/--image-lock requires a file/);
});
