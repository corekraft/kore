import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SAFETY_PATTERNS } from "../../src/idea/index.js";

const kbCheck = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../src/kb/idea-checks.ts",
  ),
  "utf8",
);

function listOf(name: string): string[] {
  const body = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(kbCheck)?.[1];
  return [...(body ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("idea schema shared by kb-check and the harness", () => {
  it("accepts the same safety patterns in both places", () => {
    expect(listOf("SAFETY_PATTERNS")).toEqual([...SAFETY_PATTERNS]);
  });
});
