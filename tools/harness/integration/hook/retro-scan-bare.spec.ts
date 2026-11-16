// Bare GitHub posts and pane sends the retro scan counts per role session, on
// synthetic transcripts run through the real session analysis and scan.

import { describe, expect, it } from "vitest";
import { scan } from "../../src/testing/index.js";
import { human } from "./retro-scan-support.js";

const bashCall = (stamp: string, id: string, command: string): string =>
  JSON.stringify({
    type: "assistant",
    timestamp: `2026-11-03T00:${stamp}:00.000Z`,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
    },
  });

const brief = (name: string): string =>
  human(
    "00",
    `Implement #836.\n\nYou are ${name}; your session name is ${name}.\n\nWhen you finish, broadcast.`,
  );

describe("retro scan bare sends", () => {
  it("counts a role session's bare comment and pane send, and its role from the ledger", () => {
    const writer = [
      brief("w1"),
      bashCall("01", "a", "gh pr comment 9 --body done"),
      bashCall("02", "b", "herdr pane send-text w2:p1 hello"),
    ].join("\n");
    const { bareCommands } = scan([{ id: "writer", text: writer }], {
      roles: { w1: "writer" },
    });
    expect(bareCommands).toEqual({
      perSession: { writer: { role: "writer", gh: 1, herdr: 1 } },
      perRole: { writer: { sessions: 1, gh: 1, herdr: 1 } },
    });
  });

  it("does not count the harness's own posts, reads of comments, or other gh and herdr commands", () => {
    const writer = [
      brief("w1"),
      bashCall("01", "a", "node skills/bin/harness.mjs pr open --body x"),
      bashCall("02", "b", "gh api repos/o/r/issues/9/comments"),
      bashCall("03", "c", "gh pr view 9 --json state"),
      bashCall("04", "d", "herdr pane read w2:p1"),
    ].join("\n");
    const { bareCommands } = scan([{ id: "writer", text: writer }], {
      roles: { w1: "writer" },
    });
    expect(bareCommands).toEqual({ perSession: {}, perRole: {} });
  });

  it("counts a comment API write as a bare GitHub post", () => {
    const fixer = [
      brief("f1"),
      bashCall(
        "01",
        "a",
        "gh api -X POST repos/o/r/issues/9/comments -f body=x",
      ),
    ].join("\n");
    const { bareCommands } = scan([{ id: "fixer", text: fixer }], {
      roles: { f1: "fixer" },
    });
    expect(bareCommands.perRole).toEqual({
      fixer: { sessions: 1, gh: 1, herdr: 0 },
    });
  });

  it("leaves out the main session, whose first typed message is no spawn brief", () => {
    const main = [
      human("00", "Please check the report before the next merge"),
      bashCall("01", "a", "gh issue comment 836 --body hi"),
      bashCall("02", "b", "herdr pane send-text w1:p1 hi"),
    ].join("\n");
    const { bareCommands } = scan([{ id: "main", text: main }], {
      roles: { w1: "writer" },
    });
    expect(bareCommands).toEqual({ perSession: {}, perRole: {} });
  });

  it("counts a role session whose launch the ledger does not hold as an unknown role", () => {
    const writer = [
      brief("w9"),
      bashCall("01", "a", "gh pr comment 9 --body x"),
    ].join("\n");
    const { bareCommands } = scan([{ id: "writer", text: writer }], {
      roles: { w1: "writer" },
    });
    expect(bareCommands.perRole).toEqual({
      unknown: { sessions: 1, gh: 1, herdr: 0 },
    });
  });
});
