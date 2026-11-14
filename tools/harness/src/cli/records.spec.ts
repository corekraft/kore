import { describe, expect, it, vi } from "vitest";
import type { Command } from "../runtime/index.js";
import { records } from "./records.js";

const {
  ideaCommands,
  challenge,
  flagCommands,
  rulesetCommands,
  statusCommand,
  judgeCommands,
  reviewCommands,
  outcomeCommands,
} = vi.hoisted(() => {
  const command = (name: string): Command => ({
    summary: name,
    run: () => Promise.resolve(0),
  });
  return {
    ideaCommands: { create: command("idea create") },
    challenge: command("challenge"),
    flagCommands: { flag: command("flag") },
    rulesetCommands: { ruleset: command("ruleset") },
    statusCommand: command("status"),
    judgeCommands: { judge: command("judge") },
    reviewCommands: { review: command("review") },
    outcomeCommands: { outcome: command("outcome") },
  };
});

vi.mock("../idea/index.js", () => ({ ideaCommands }));
vi.mock("./challenge-commands.js", () => ({ challenge }));
vi.mock("./flag-commands.js", () => ({ flagCommands }));
vi.mock("../ruleset/index.js", () => ({ rulesetCommands }));
vi.mock("./status-command.js", () => ({ statusCommand }));
vi.mock("./judge-commands.js", () => ({ judgeCommands, reviewCommands }));
vi.mock("./outcome-commands.js", () => ({ outcomeCommands }));

describe("records command map", () => {
  it("groups the delivery loop's records under exactly these domain words", () => {
    expect(Object.keys(records).sort()).toEqual([
      "flag",
      "idea",
      "judge",
      "outcome",
      "review",
      "ruleset",
      "status",
    ]);
  });

  it("adds the challenge command to the idea domain beside the idea commands", () => {
    expect(records.idea).toEqual({ create: ideaCommands.create, challenge });
  });

  it("maps flag, ruleset, outcome, judge and review to their own command maps", () => {
    expect(records.flag).toBe(flagCommands);
    expect(records.ruleset).toBe(rulesetCommands);
    expect(records.outcome).toBe(outcomeCommands);
    expect(records.judge).toBe(judgeCommands);
    expect(records.review).toBe(reviewCommands);
  });

  it("gives status the empty command word, since it is the domain's only command", () => {
    expect(records.status).toEqual({ "": statusCommand });
  });
});
