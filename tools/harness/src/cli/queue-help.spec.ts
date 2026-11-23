import { describe, expect, it, vi } from "vitest";
import type { Command, CommandHelp } from "../runtime/index.js";
import { escalateHelp, nextHelp, queueDomain } from "./queue-help.js";

// The two queue commands are collaborators: the records are checked against the flags each
// command declares, and the composition keeps each command's own run.
vi.mock("./queue-commands.js", () => ({
  nextCommand: {
    summary: "next",
    options: { ledger: "string", explain: "string" },
    run: () => Promise.resolve(0),
  },
  escalateCommand: {
    summary: "escalate",
    operand: "pr",
    options: { ledger: "string", check: "boolean" },
    run: () => Promise.resolve(0),
  },
}));

const records: [string, CommandHelp, string[]][] = [
  ["next", nextHelp, ["explain", "ledger"]],
  ["escalate", escalateHelp, ["check", "ledger"]],
];

/** The flags an example names, without the -- prefix. */
const flagsNamed = (command: string): string[] =>
  command
    .split(/\s+/)
    .filter((word) => word.startsWith("--"))
    .map((word) => word.slice(2));

describe("the queue help records", () => {
  it("describes each declared flag once, in one line, and nothing undeclared", () => {
    for (const [, help, declared] of records) {
      expect(Object.keys(help.flags).sort()).toEqual(declared);
      for (const text of Object.values(help.flags)) {
        expect(text.trim()).not.toBe("");
        expect(text).not.toMatch(/[\r\n]/);
      }
    }
  });

  it("names only declared flags, plus the global json and help, in every example", () => {
    for (const [, help, declared] of records) {
      for (const example of help.examples) {
        for (const flag of flagsNamed(example.command)) {
          expect(["json", "help", ...declared]).toContain(flag);
        }
      }
    }
  });

  it("describes the pr operand of escalate, and no operand for next", () => {
    expect(escalateHelp.operand).toBe("The pull request number, such as 746.");
    expect(nextHelp.operand).toBeUndefined();
  });

  it("gives every record examples and exit codes, and marks only escalate as mutating", () => {
    for (const [name, help] of records) {
      expect(help.examples.length).toBeGreaterThan(0);
      expect(help.exits.length).toBeGreaterThan(0);
      expect(help.effects.kind).toBe(
        name === "escalate" ? "mutates" : "read-only",
      );
    }
  });
});

describe("the queue domain table", () => {
  it("keeps each command's own run and adds its help record", () => {
    expect(Object.keys(queueDomain)).toEqual(["next", "escalate"]);
    expect(queueDomain["next"]?.help).toBe(nextHelp);
    expect(queueDomain["escalate"]?.help).toBe(escalateHelp);
    expect(queueDomain["next"]?.summary).toBe("next");
  });

  it("keeps each command's declared flags in its table entry", () => {
    const command: Command | undefined = queueDomain["next"];
    expect(command?.options).toEqual({ ledger: "string", explain: "string" });
  });
});
