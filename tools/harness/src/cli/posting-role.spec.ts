// The posting commands take no --role flag. The sender line is read from the spawn
// environment, so no flag can name a role: the parser refuses an undeclared flag
// (cli.spec.ts), and this pins that no posting command declares one.
import { describe, expect, it } from "vitest";
import type { Command } from "../runtime/index.js";
import { decisionCommands } from "./decision-commands.js";
import { guardrailLedgerCommands } from "./guardrail-request-commands.js";
import { approveCommands } from "./judge-approve-command.js";
import { mergeCommands } from "./judge-merge-commands.js";
import { outcomeCommands } from "./outcome-commands.js";
import { prCommands } from "./pr-commands.js";
import { reviewCommands } from "./review-commands.js";

const POSTING: [string, Command | undefined][] = [
  ["judge send-back", mergeCommands["send-back"]],
  ["judge approve", approveCommands["approve"]],
  ["guardrail request", guardrailLedgerCommands["request"]],
  ["decision make", decisionCommands["make"]],
  ["outcome record", outcomeCommands["record"]],
  ["outcome close", outcomeCommands["close"]],
  ["pr open", prCommands["open"]],
  ["review post", reviewCommands["post"]],
];

describe.each(POSTING)("harness %s", (_name, command) => {
  it("declares no --role flag, so a role cannot be supplied by hand", () => {
    expect(command).toBeDefined();
    expect(Object.keys(command?.options ?? {})).not.toContain("role");
  });
});
