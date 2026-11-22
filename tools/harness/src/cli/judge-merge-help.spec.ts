import { describe, expect, it } from "vitest";
import { SEND_BACK_CATEGORIES } from "../ledger/index.js";
import { mergeHelp, sendBackHelp } from "./judge-merge-help.js";

describe("the judge merge help record", () => {
  it("describes its one flag in one line, and no other", () => {
    expect(Object.keys(mergeHelp.flags)).toEqual(["reviewer"]);
    const multiLine = Object.entries(mergeHelp.flags)
      .filter(([, text]) => text.trim() === "" || text.includes("\n"))
      .map(([name]) => name);
    expect(multiLine).toEqual([]);
  });

  it("gives exit codes 0, 1 and 2, in order", () => {
    expect(mergeHelp.exits.map((exit) => exit.code)).toEqual([0, 1, 2]);
  });

  it("says the merge mutates GitHub, and that a failing audit gate never blocks it", () => {
    expect(mergeHelp.effects.kind).toBe("mutates");
    expect(mergeHelp.effects.detail).toContain(
      "squash-merges the PR on GitHub",
    );
    expect(mergeHelp.purpose).toContain(
      "A failing audit gate is logged and never blocks the merge.",
    );
  });

  it("gives only examples that run the merge command itself", () => {
    const others = mergeHelp.examples
      .map((example) => example.command)
      .filter((command) => !command.startsWith("harness judge merge "));
    expect(others).toEqual([]);
  });
});

describe("the judge send-back help record", () => {
  it("describes the reason, its file and the category flags, and no other", () => {
    expect(Object.keys(sendBackHelp.flags)).toEqual([
      "reason",
      "reason-file",
      "category",
    ]);
  });

  it("names every send-back category the ledger accepts", () => {
    const category = sendBackHelp.flags["category"] ?? "";
    const missing = SEND_BACK_CATEGORIES.filter(
      (name) => !category.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it("gives exit codes 0, 1 and 2, in order", () => {
    expect(sendBackHelp.exits.map((exit) => exit.code)).toEqual([0, 1, 2]);
  });

  it("says it posts a comment and records an event, and never merges or approves", () => {
    expect(sendBackHelp.effects.kind).toBe("mutates");
    expect(sendBackHelp.effects.detail).toContain(
      "nothing is merged or approved",
    );
  });
});
