import { describe, expect, it } from "vitest";
import type { CommandHelp } from "../runtime/index.js";
import { createHelp, listHelp, showHelp, syncHelp } from "./commands-help.js";

/** Every flag `idea new` declares, which its help must describe. */
const NEW_FLAGS = [
  "title",
  "slug",
  "summary",
  "hypothesis",
  "expected-outcome",
  "measurement",
  "safety-pattern",
  "issue",
  "parent",
  "kind",
  "metric",
  "direction",
  "window",
  "tier-change",
  "guard-metric",
];

const records: [string, CommandHelp][] = [
  ["idea new", createHelp],
  ["idea list", listHelp],
  ["idea show", showHelp],
  ["idea sync", syncHelp],
];

describe("the idea command help records", () => {
  it.each(records)(
    "%s says what it does, when to run it and when not",
    (_path, help) => {
      expect(help.purpose.trim()).not.toBe("");
      expect(help.when.trim()).not.toBe("");
      expect(help.whenNot.trim()).not.toBe("");
    },
  );

  it.each(records)(
    "%s gives examples that each start with harness idea and say what they show",
    (_path, help) => {
      expect(help.examples.length).toBeGreaterThan(0);
      for (const example of help.examples) {
        expect(example.command.startsWith("harness idea ")).toBe(true);
        expect(example.shows.trim()).not.toBe("");
      }
    },
  );

  it.each(records)(
    "%s lists exit codes 0, 1 and 2 once each, with a meaning for each",
    (_path, help) => {
      expect(help.exits.map((exit) => exit.code)).toEqual([0, 1, 2]);
      for (const exit of help.exits) {
        expect(exit.meaning.trim()).not.toBe("");
      }
    },
  );

  it("describes exactly the flags each command declares, each in one line", () => {
    expect(Object.keys(createHelp.flags).sort()).toEqual([...NEW_FLAGS].sort());
    expect(Object.keys(listHelp.flags)).toEqual([]);
    expect(Object.keys(showHelp.flags)).toEqual(["idea"]);
    expect(Object.keys(syncHelp.flags)).toEqual(["idea"]);
    for (const help of [createHelp, showHelp, syncHelp]) {
      for (const text of Object.values(help.flags)) {
        expect(text.trim()).not.toBe("");
        expect(text).not.toContain("\n");
      }
    }
  });

  it("says that list and show only read, and that new and sync mutate", () => {
    expect(listHelp.effects.kind).toBe("read-only");
    expect(showHelp.effects.kind).toBe("read-only");
    expect(createHelp.effects.kind).toBe("mutates");
    expect(syncHelp.effects.kind).toBe("mutates");
  });

  it("tells a reader that a recorded issue which no longer exists is replaced by a new one", () => {
    expect(syncHelp.purpose).toContain(
      "When the recorded issue no longer exists on GitHub, a new issue is created and its link replaces the recorded one.",
    );
    expect(syncHelp.effects.detail).toContain(
      "replacing a recorded link when the old issue no longer exists",
    );
  });

  it("says sync never removes a label or changes assignees", () => {
    expect(syncHelp.effects.detail).toContain(
      "No label is removed and assignees are never changed.",
    );
  });
});
