import { describe, expect, it } from "vitest";
import { GLOB_CASES } from "./guard-corpus-glob.js";

describe("glob corpus data", () => {
  it("refuses every zsh glob qualifier as an unquoted glob", () => {
    expect(GLOB_CASES.length).toBeGreaterThan(0);
    expect(GLOB_CASES.filter((c) => c.rule !== "unquoted-glob")).toEqual([]);
  });

  it("names the qualifier that runs code for every role it covers, and no other rule", () => {
    expect(GLOB_CASES).toContainEqual({
      tool: "Bash",
      input: "ls *(e:'touch pwned':)",
      rule: "unquoted-glob",
    });
    expect(GLOB_CASES).toContainEqual({
      role: "writer",
      tool: "Bash",
      input: "zsh -c \"ls *(e:'id':)\"",
      rule: "unquoted-glob",
    });
  });
});
