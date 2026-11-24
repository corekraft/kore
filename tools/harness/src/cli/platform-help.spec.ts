import { describe, expect, it } from "vitest";
import type { CommandHelp } from "../runtime/index.js";
import { driftHelp, recordHelp } from "./platform-help.js";

const records: [string, CommandHelp, string][] = [
  ["rollout-record", recordHelp, "mutates"],
  ["rollout-drift", driftHelp, "read-only"],
];

describe("the platform help records", () => {
  it.each(records)(
    "%s states its purpose, when and whenNot",
    (_name, record) => {
      expect(record.purpose.trim()).not.toBe("");
      expect(record.when.trim()).not.toBe("");
      expect(record.whenNot.trim()).not.toBe("");
    },
  );

  it.each(records)(
    "%s gives examples that name its own command and say what they show",
    (name, record) => {
      expect(record.examples.length).toBeGreaterThan(0);
      for (const example of record.examples) {
        expect(example.command).toContain(`harness platform ${name}`);
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
    "%s lists exit 0 once, each exit with a meaning",
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
    "%s declares whether it mutates: only the record command does",
    (_name, record, kind) => {
      expect(record.effects.kind).toBe(kind);
    },
  );
});
