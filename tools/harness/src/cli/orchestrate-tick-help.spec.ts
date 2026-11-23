import { describe, expect, it } from "vitest";
import { tickHelp } from "./orchestrate-tick-help.js";

/** The flags an example names, without the -- prefix. */
const flagsNamed = (command: string): string[] =>
  command
    .split(/\s+/)
    .filter((word) => word.startsWith("--"))
    .map((word) => word.slice(2));

describe("the orchestrate tick help record", () => {
  it("describes each declared flag in one line, and no other", () => {
    expect(Object.keys(tickHelp.flags).sort()).toEqual([
      "evidence",
      "idea",
      "install",
      "kind",
      "loop",
      "result",
      "source",
      "summary",
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
        expect(Object.keys(tickHelp.flags).concat(["json", "help"])).toContain(
          flag,
        );
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

describe("the orchestrate tick help record for the one-idea run", () => {
  it("shows the one-idea run, with and without an outcome, and names no command that no longer exists", () => {
    const commands = tickHelp.examples.map((example) => example.command);
    expect(commands).toContain("harness orchestrate tick --idea 0007 --loop");
    expect(
      commands.some(
        (command) =>
          command.includes("--idea 0007 --loop") &&
          flagsNamed(command).includes("summary"),
      ),
    ).toBe(true);
    expect(JSON.stringify(tickHelp)).not.toContain("orchestrate run");
  });

  it("says the one-idea run files retro proposals through a checked, capped, idempotent path, on Sonnet", () => {
    const detail = tickHelp.effects.detail;
    expect(detail).toContain("starts a retro pane on Sonnet at high effort");
    expect(detail).toContain("files nothing when one item is malformed");
    expect(detail).toContain("files at most 5");
    expect(detail).toContain("trigger id plus a content hash");
    expect(detail).not.toContain("Opus");
  });

  it("says a failing precheck is sent back to the writer before any judge pane, counted once per PR head", () => {
    const detail = tickHelp.effects.detail;
    expect(detail).toContain(
      "runs judge precheck before it launches any judge pane",
    );
    expect(detail).toContain(
      "sends the change back to its writer through judge send-back with the precheck's reason and category",
    );
    expect(detail).toContain("launching no judge pane");
    expect(detail).toContain("counted once per PR head");
  });
});
