import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasNonLiteralLoad,
  importSpecifiers,
} from "../tests/import-scan-support.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const harnessRoot = resolve(here, "..");
const bundle = resolve(harnessRoot, "../../skills/bin/harness.mjs");
const esbuild = resolve(harnessRoot, "node_modules/.bin/esbuild");

let temp = "";
beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), "harness-bundle-"));
  // Build the real bundle into a temp directory so the no-node_modules run
  // never depends on the repository layout.
  execFileSync(
    esbuild,
    [
      "src/main.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node26",
      "--legal-comments=none",
      `--outfile=${join(temp, "built", "harness.mjs")}`,
      "--log-level=error",
    ],
    { cwd: harnessRoot },
  );
  cpSync(join(temp, "built", "harness.mjs"), join(temp, "harness.mjs"));
});
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function node(file: string, ...args: string[]) {
  // cwd is a temp directory with no node_modules anywhere above it.
  return execFileSync(process.execPath, [file, ...args], {
    cwd: temp,
    encoding: "utf8",
  });
}

describe("bundled harness", () => {
  it("runs --help from a directory with no node_modules", () => {
    expect(readdirSync(temp)).not.toContain("node_modules");
    expect(node(join(temp, "harness.mjs"), "--help")).toContain(
      "Usage: harness",
    );
  });

  it("the built skills/bin/harness.mjs runs --help from a temp directory", () => {
    expect(node(bundle, "--help")).toContain("Usage: harness");
    expect(
      JSON.parse(node(bundle, "harness", "version", "--json")),
    ).toHaveProperty("version");
  });

  it("loads only Node built-ins, by any import form, with no dynamic loads", () => {
    const code = readFileSync(bundle, "utf8");
    const specs = importSpecifiers(code);
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.filter((spec) => !spec.startsWith("node:"))).toEqual([]);
    expect(hasNonLiteralLoad(code)).toBe(false);
  });
});
