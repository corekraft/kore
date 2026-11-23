import { describe, expect, it } from "vitest";
import type { CommandHelp } from "../runtime/index.js";
import * as help from "./decision-help.js";

// The decision help records are data. These tests pin what each record must say: its text,
// its examples, its exits, the flag gate, and the append-only note on each writer. The
// make record lives beside its command in decision-commands.ts.
const records: [string, CommandHelp][] = [["ask", help.askHelp]];

describe("the decision help records", () => {
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
        expect(example.command.startsWith("harness decision ")).toBe(true);
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

  it.each(records)(
    "%s says it mutates the ledger, and that the ledger is append-only",
    (_name, record) => {
      expect(record.effects.kind).toBe("mutates");
      expect(record.effects.detail).toContain("append-only");
    },
  );

  it.each(records)(
    "%s says the decision-advisor flag refuses it while the flag is off",
    (_name, record) => {
      expect(record.purpose).toContain("decision-advisor flag is off");
    },
  );

  it("describes exactly the flags each command declares", () => {
    expect(Object.keys(help.askHelp.flags).sort()).toEqual([
      "action",
      "action-file",
      "category",
      "idea",
      "ledger",
      "question",
      "question-file",
    ]);
  });
});
