import { describe, expect, it } from "vitest";
import { PROMPT } from "./prompt.js";

describe("PROMPT", () => {
  it.each([
    ["a bare prompt mark", "> finish the task"],
    ["the other prompt mark", "❯ finish the task"],
    ["indent before the mark", "   > indented"],
    ["a box border before the mark", "│ > boxed"],
    ["a pipe border before the mark", "| > piped"],
  ])("matches a line that starts with a prompt mark: %s", (_label, line) => {
    expect(PROMPT.test(line)).toBe(true);
  });

  it.each([
    ["a line with no mark", "Fixed the parser."],
    ["a mark after other text", "see > here"],
    ["Claude's bullet, which is not a prompt", "● Fixed the parser."],
    ["an empty line", ""],
  ])("does not match %s", (_label, line) => {
    expect(PROMPT.test(line)).toBe(false);
  });
});
