import { describe, expect, it } from "vitest";
import type { CommandHelp } from "../runtime/index.js";
import * as help from "./ledger-help.js";

// The ledger help records are data. These tests pin what each record must say: its text,
// its examples, its exits, and the append-only note on every command that writes the ledger.
const records: [string, CommandHelp][] = [
  ["record", help.recordHelp],
  ["list", help.listHelp],
  ["poll-herdr", help.pollHerdrHelp],
  ["poll-github", help.pollGithubHelp],
];

const writers = ["record", "poll-herdr", "poll-github"];

describe("the ledger help records", () => {
  it.each(records)(
    "%s states its purpose, when and whenNot as text",
    (_name, record) => {
      expect(record.purpose.trim()).not.toBe("");
      expect(record.when.trim()).not.toBe("");
      expect(record.whenNot.trim()).not.toBe("");
    },
  );

  it.each(records)(
    "%s gives examples that start with harness and say what they show",
    (_name, record) => {
      expect(record.examples.length).toBeGreaterThan(0);
      for (const example of record.examples) {
        expect(example.command.startsWith("harness ledger ")).toBe(true);
        expect(example.shows.trim()).not.toBe("");
      }
    },
  );

  it.each(records)("%s describes every flag in one line", (_name, record) => {
    for (const text of Object.values(record.flags)) {
      expect(text.trim()).not.toBe("");
      expect(text).not.toMatch(/[\r\n]/);
    }
  });

  it.each(records)(
    "%s lists exit 0 and no exit code twice, each with a meaning",
    (_name, record) => {
      const codes = record.exits.map((exit) => exit.code);
      expect(codes).toContain(0);
      expect(new Set(codes).size).toBe(codes.length);
      for (const exit of record.exits) {
        expect(exit.meaning.trim()).not.toBe("");
      }
    },
  );

  it.each(writers)(
    "%s says it mutates the ledger and that the ledger is append-only",
    (name) => {
      const record = records.find(([key]) => key === name)?.[1];
      expect(record?.effects.kind).toBe("mutates");
      expect(record?.effects.detail).toContain("append-only");
    },
  );

  it("says list is read-only and writes nothing", () => {
    expect(help.listHelp.effects.kind).toBe("read-only");
    expect(help.listHelp.effects.detail).toContain("writes nothing");
  });
});

describe("the ledger help flags", () => {
  it("describes exactly the flags each command declares", () => {
    expect(Object.keys(help.recordHelp.flags).sort()).toEqual([
      "agent",
      "id",
      "idea",
      "kind",
      "label",
      "ledger",
      "number",
      "occurred-at",
      "outcome",
      "pane",
      "role",
      "session",
      "source",
      "stage",
      "tier",
      "tokens",
      "tool",
    ]);
    expect(Object.keys(help.listHelp.flags).sort()).toEqual([
      "idea",
      "kind",
      "ledger",
      "pane",
      "session",
      "since",
      "source",
      "until",
    ]);
    expect(Object.keys(help.pollHerdrHelp.flags)).toEqual(["ledger"]);
    expect(Object.keys(help.pollGithubHelp.flags).sort()).toEqual([
      "ledger",
      "repo",
      "since",
    ]);
  });
});
