import { describe, expect, it } from "vitest";
import { tickHelp } from "./orchestrate-tick-help.js";

/** The flags an example names, without the -- prefix. */
const flagsNamed = (command: string): string[] =>
  command
    .split(/\s+/)
    .filter((word) => word.startsWith("--"))
    .map((word) => word.slice(2));

describe("the orchestrate tick help record", () => {
  it("describes each of the three declared flags in one line, and no other", () => {
    expect(Object.keys(tickHelp.flags).sort()).toEqual([
      "idea",
      "install",
      "loop",
    ]);
    for (const text of Object.values(tickHelp.flags)) {
      expect(text.trim()).not.toBe("");
      expect(text).not.toMatch(/[\r\n]/);
    }
  });

  it("names only declared flags, plus the global json and help, in every example", () => {
    for (const example of tickHelp.examples) {
      expect(example.command.startsWith("harness orchestrate tick")).toBe(true);
      for (const flag of flagsNamed(example.command)) {
        expect(["idea", "loop", "install", "json", "help"]).toContain(flag);
      }
    }
  });

  it("gives each example a shows line and the exit codes 0 and 1 a meaning", () => {
    for (const example of tickHelp.examples) {
      expect(example.shows.trim()).not.toBe("");
    }
    expect(tickHelp.exits.map((exit) => exit.code)).toEqual([0, 1]);
    for (const exit of tickHelp.exits) {
      expect(exit.meaning.trim()).not.toBe("");
    }
  });

  it("says the self-update fast-forwards a clean main, and that nothing is pushed or merged", () => {
    expect(tickHelp.effects.kind).toBe("mutates");
    expect(tickHelp.effects.detail).toContain("git pull --ff-only");
    expect(tickHelp.effects.detail).toContain(
      "never pushes or merges a branch",
    );
  });
});
