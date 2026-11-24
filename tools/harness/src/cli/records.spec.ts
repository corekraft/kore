import { describe, expect, it, vi } from "vitest";
import type { Command, CommandHelp } from "../runtime/index.js";
import { records } from "./records.js";

const {
  ideaCommands,
  flagCommands,
  platformCommands,
  rulesetCommands,
  statusCommand,
  judgeCommands,
  reviewCommands,
  outcomeCommands,
  decisionCommands,
  prCommands,
} = vi.hoisted(() => {
  const HELP: CommandHelp = {
    purpose: "A stub command.",
    when: "In a test.",
    whenNot: "Outside a test.",
    flags: {},
    examples: [{ command: "harness stub", shows: "nothing" }],
    exits: [{ code: 0, meaning: "always" }],
    effects: { kind: "read-only", detail: "nothing" },
    seeAlso: [],
  };
  const command = (name: string): Command => ({
    help: HELP,
    summary: name,
    run: () => Promise.resolve(0),
  });
  return {
    ideaCommands: { create: command("idea create") },
    flagCommands: { flag: command("flag") },
    platformCommands: { "rollout-record": command("platform rollout-record") },
    rulesetCommands: { ruleset: command("ruleset") },
    statusCommand: command("status"),
    judgeCommands: { judge: command("judge") },
    reviewCommands: { review: command("review") },
    outcomeCommands: { outcome: command("outcome") },
    decisionCommands: { make: command("decision make") },
    prCommands: { open: command("pr open") },
  };
});

vi.mock("./idea-commands.js", () => ({ ideaRecordCommands: ideaCommands }));
vi.mock("./release-records.js", () => ({
  releaseRecords: { flag: flagCommands, platform: platformCommands },
}));
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
      "platform",
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

  it("maps flag, platform, ruleset, outcome, decision, judge, review and pr to their own command maps", () => {
    expect(records.flag).toBe(flagCommands);
    expect(records.platform).toBe(platformCommands);
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
