import { describe, expect, it } from "vitest";
import { replayHelp } from "./guardrail-replay-help.js";

// The options `guardrail replay` declares, as its command table declares them. The record must
// describe exactly these, and nothing else.
const DECLARED = ["rule", "old", "new", "since", "until"];

describe("the guardrail replay help record", () => {
  it("describes each declared flag once, in one non-empty line, and no other flag", () => {
    expect(Object.keys(replayHelp.flags).sort()).toEqual([...DECLARED].sort());
    for (const [name, text] of Object.entries(replayHelp.flags)) {
      expect(text.trim(), name).not.toBe("");
      expect(text, name).not.toContain("\n");
    }
  });

  it("gives every example a command that starts with the replay command and uses only declared flags", () => {
    const allowed = new Set([...DECLARED, "json", "help"]);
    const problems = replayHelp.examples.flatMap(({ command }) => {
      const words = command.split(/\s+/);
      const prefix = words.slice(0, 3).join(" ");
      const undeclared = words
        .filter((word) => word.startsWith("--"))
        .map((word) => word.slice(2))
        .filter((name) => !allowed.has(name));
      return [
        ...(prefix === "harness guardrail replay"
          ? []
          : [`${command}: not a replay command`]),
        ...undeclared.map((name) => `${command}: undeclared flag --${name}`),
      ];
    });
    expect(problems).toEqual([]);
  });

  it("lists exits 0, 1 and 2, each once, with a meaning", () => {
    expect(replayHelp.exits.map((exit) => exit.code)).toEqual([0, 1, 2]);
    for (const exit of replayHelp.exits) {
      expect(exit.meaning.trim(), String(exit.code)).not.toBe("");
    }
  });

  it("states the effects as read-only, and says the ledger is never read", () => {
    expect(replayHelp.effects.kind).toBe("read-only");
    expect(replayHelp.effects.detail).toContain("never reads the ledger");
  });

  it("names the five steps of the guard-idea checklist in order, in when", () => {
    expect(replayHelp.when).toMatch(/\(1\) .*\(2\) .*\(3\) .*\(4\) .*\(5\) /);
  });
});
