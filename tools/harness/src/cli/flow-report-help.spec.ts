import { describe, expect, it } from "vitest";
import { reportHelp } from "./flow-report-help.js";

// The record is data, so these tests read it alone. The registry specs check it
// against the command's declared flags; these pin what the record itself promises.
describe("the flow report help record", () => {
  it("describes exactly the flags the report declares, each on one line", () => {
    expect(Object.keys(reportHelp.flags)).toEqual([
      "min-ideas",
      "trailing",
      "host-days",
      "window-effort",
      "as-of",
      "since",
      "until",
      "split-at",
      "idea",
      "ledger",
    ]);
    for (const [name, text] of Object.entries(reportHelp.flags)) {
      expect(text.trim(), name).not.toBe("");
      expect(text, name).not.toContain("\n");
    }
  });

  it("gives examples that each run the flow report command", () => {
    expect(reportHelp.examples.length).toBeGreaterThan(0);
    for (const example of reportHelp.examples) {
      expect(
        example.command.startsWith("harness flow report"),
        example.command,
      ).toBe(true);
      expect(example.shows.trim(), example.command).not.toBe("");
    }
  });

  it("names exit codes 0, 1 and 2, each once, with a meaning", () => {
    expect(reportHelp.exits.map((exit) => exit.code)).toEqual([0, 1, 2]);
    for (const exit of reportHelp.exits) {
      expect(exit.meaning.trim(), String(exit.code)).not.toBe("");
    }
  });

  it("is read-only, and says it writes nothing", () => {
    expect(reportHelp.effects.kind).toBe("read-only");
    expect(reportHelp.effects.detail).toContain("writes nothing");
  });
});
