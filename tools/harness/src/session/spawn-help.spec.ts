import { describe, expect, it } from "vitest";
import { spawnHelp } from "./spawn-help.js";

// The flags `session spawn` takes, as session/index.ts declares them: the help must describe each one, and no other.
const SPAWN_FLAGS = [
  "role",
  "model",
  "effort",
  "name",
  "brief",
  "no-wait",
  "worktree",
  "branch",
  "idea",
  "no-idea",
  "pr",
  "reason",
  "timeout",
  "group",
];

describe("spawnHelp: the record `session spawn --help` prints", () => {
  it("describes every flag spawn takes, and no flag it does not", () => {
    expect(Object.keys(spawnHelp.flags ?? {}).sort()).toEqual(
      [...SPAWN_FLAGS].sort(),
    );
  });

  it("states its purpose, when and whenNot as text", () => {
    for (const field of [
      spawnHelp.purpose,
      spawnHelp.when,
      spawnHelp.whenNot,
    ]) {
      expect(typeof field).toBe("string");
      expect(field).not.toBe("");
    }
  });

  it("gives examples that all run session spawn", () => {
    expect(spawnHelp.examples?.length ?? 0).toBeGreaterThan(0);
    for (const example of spawnHelp.examples ?? []) {
      expect(example.command).toMatch(/^harness session spawn /);
    }
  });

  it("names exit 0, 1 and 2, with 2 as the usage refusal before any terminal starts", () => {
    const codes = (spawnHelp.exits ?? []).map((exit) => exit.code);
    expect(codes).toEqual([0, 1, 2]);
    expect(spawnHelp.exits?.[2]?.meaning).toContain(
      "before any terminal starts",
    );
  });

  it("declares that it mutates, and names the ledger events it appends", () => {
    expect(spawnHelp.effects?.kind).toBe("mutates");
    expect(spawnHelp.effects?.detail).toContain("session.launch");
  });

  it("points to the commands a spawned session is followed by", () => {
    expect(spawnHelp.seeAlso).toEqual(
      expect.arrayContaining(["session wait", "session close"]),
    );
  });
});
