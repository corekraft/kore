// The seven-reads corpus is data: the spec keeps it from shrinking or going blank silently.

import { describe, expect, it } from "vitest";
import { READS_ALLOWED, READS_REFUSED } from "./guard-corpus-reads.js";

describe("seven-reads corpus data", () => {
  it("allows each of the seven reads at least once", () => {
    const names = ["merge-base", "cat-file", "ls-tree", "ls-remote"];
    expect(
      names.filter((n) => !READS_ALLOWED.some((c) => c.includes(n))),
    ).toEqual([]);
    expect(READS_ALLOWED.filter((c) => c.startsWith("which "))).toHaveLength(1);
    expect(
      READS_ALLOWED.filter((c) => c.startsWith("command -v ")),
    ).toHaveLength(1);
    expect(
      READS_ALLOWED.filter((c) => c.endsWith("harness.mjs --help")),
    ).toHaveLength(1);
  });

  it("refuses git fetch and each writing option the ticket names", () => {
    for (const option of [
      "git fetch",
      "--upload-pack",
      "-c ",
      "-o ",
      "--output",
    ]) {
      expect(
        READS_REFUSED.some((c) => c.includes(option)),
        option,
      ).toBe(true);
    }
  });

  it("holds no blank or repeated call, and no call is both allowed and refused", () => {
    const all = [...READS_ALLOWED, ...READS_REFUSED];
    expect(all.filter((c) => c.trim() === "")).toEqual([]);
    expect(new Set(all).size).toBe(all.length);
  });
});
