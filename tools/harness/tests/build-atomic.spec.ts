import { execFileSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "harness-build-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const build = (out: string) =>
  execFileSync(process.execPath, ["build.mjs", out], {
    cwd: harnessRoot,
    encoding: "utf8",
  });

describe("the bundle build", () => {
  it("replaces the live bundle by rename, so a reader never sees a half-written file", () => {
    const out = join(dir, "harness.mjs");
    writeFileSync(out, "// old bundle\n");
    // A second name for the old inode keeps what an in-place write would truncate.
    linkSync(out, join(dir, "reader-view.mjs"));
    build(out);
    expect(readFileSync(join(dir, "reader-view.mjs"), "utf8")).toBe(
      "// old bundle\n",
    );
    expect(readFileSync(out, "utf8")).toContain("Usage: harness");
  });

  it("leaves no temporary file beside the bundle", () => {
    build(join(dir, "harness.mjs"));
    expect(readdirSync(dir)).toEqual(["harness.mjs"]);
  });

  it("fails loudly and leaves no temporary file when the bundle cannot be put in place", () => {
    // The destination is a non-empty directory, so the final rename fails.
    const out = join(dir, "harness.mjs");
    mkdirSync(out);
    writeFileSync(join(out, "keep"), "x");
    expect(() => build(out)).toThrow();
    expect(readdirSync(dir)).toEqual(["harness.mjs"]);
    expect(readdirSync(out)).toEqual(["keep"]);
  });
});
