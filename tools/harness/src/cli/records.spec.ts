import { describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";
import { records } from "./records.js";

const {
  ideaCommands,
  flagCommands,
  rulesetCommands,
  statusCommand,
  judgeCommands,
  reviewCommands,
  outcomeCommands,
  decisionCommands,
  prCommands,
} = vi.hoisted(() => {
  const command = (name: string): Command => ({
    summary: name,
    run: () => Promise.resolve(0),
  });
  return {
    ideaCommands: { create: command("idea create") },
    flagCommands: { flag: command("flag") },
    rulesetCommands: { ruleset: command("ruleset") },
    statusCommand: command("status"),
    judgeCommands: { judge: command("judge") },
    reviewCommands: { review: command("review") },
    outcomeCommands: { outcome: command("outcome") },
    decisionCommands: { make: command("decision make") },
    prCommands: { open: command("pr open") },
  };
});

vi.mock("../idea/index.js", () => ({ ideaCommands }));
vi.mock("./flag-commands.js", () => ({ flagCommands }));
vi.mock("../ruleset/index.js", () => ({ rulesetCommands }));
vi.mock("./status-command.js", () => ({ statusCommand }));
vi.mock("./judge-commands.js", () => ({
  judgeCommands,
  reviewCommands,
  prCommands,
}));
vi.mock("./outcome-commands.js", () => ({ outcomeCommands }));
vi.mock("./decision-commands.js", () => ({ decisionCommands }));

describe("records command map", () => {
  it("groups the delivery loop's records under exactly these domain words", () => {
    expect(Object.keys(records).sort()).toEqual([
      "decision",
      "flag",
      "idea",
      "judge",
      "outcome",
      "pr",
      "review",
      "ruleset",
      "status",
    ]);
  });

  it("maps idea to the idea commands alone, with no challenge command", () => {
    expect(records.idea).toBe(ideaCommands);
    expect(Object.keys(records.idea ?? {})).not.toContain("challenge");
  });

  it("maps flag, ruleset, outcome, decision, judge, review and pr to their own command maps", () => {
    expect(records.flag).toBe(flagCommands);
    expect(records.ruleset).toBe(rulesetCommands);
    expect(records.outcome).toBe(outcomeCommands);
    expect(records.decision).toBe(decisionCommands);
    expect(records.judge).toBe(judgeCommands);
    expect(records.review).toBe(reviewCommands);
    expect(records.pr).toBe(prCommands);
  });

  it("gives status the empty command word, since it is the domain's only command", () => {
    expect(records.status).toEqual({ "": statusCommand });
  });
});
