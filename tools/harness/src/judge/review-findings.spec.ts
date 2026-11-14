import { describe, expect, it } from "vitest";
import { JudgeError } from "./errors.js";
import { findingsFrom } from "./review-findings.js";

describe("findingsFrom reads the verdict from stdin and refuses an unclear one", () => {
  it("reads one finding per line and drops blank lines and surrounding spaces", () => {
    expect(findingsFrom("a\n\n  b  \n", false)).toEqual(["a", "b"]);
  });

  it("treats --none with empty stdin as a clean review", () => {
    expect(findingsFrom("", true)).toEqual([]);
  });

  it("refuses --none when findings are on stdin, and says which to drop", () => {
    expect(() => findingsFrom("a finding", true)).toThrow(JudgeError);
    expect(() => findingsFrom("a finding", true)).toThrow(/drop --none/);
  });

  it("refuses a post with neither --none nor findings, and names the fix", () => {
    expect(() => findingsFrom("  \n", false)).toThrow(JudgeError);
    expect(() => findingsFrom("  \n", false)).toThrow(/pass --none/);
  });
});
