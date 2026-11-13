import { beforeEach, describe, expect, it, vi } from "vitest";
import { block } from "./guard-verdict.js";
import { checkAgentStart } from "./guard-agent-start.js";

vi.mock("./guard-verdict.js");

const BLOCKED = {
  action: "block",
  rule: "bare-agent-start",
  message: "[guard:bare-agent-start] stub",
} as const;

describe("checkAgentStart", () => {
  beforeEach(() => {
    vi.mocked(block).mockReset();
    vi.mocked(block).mockReturnValue(BLOCKED);
  });

  it("blocks a bare herdr agent start and names harness session spawn as the fix", () => {
    const finding = checkAgentStart("herdr", [
      "agent",
      "start",
      "w3:p2",
      "--permission-mode",
      "bypassPermissions",
    ]);

    expect(finding).toBe(BLOCKED);
    expect(block).toHaveBeenCalledTimes(1);
    expect(vi.mocked(block).mock.calls[0]).toEqual([
      "bare-agent-start",
      'herdr agent start launches a session without the role guards, the writer host-lease refusal or the role tokens, which only harness session spawn applies. Instead, launch the session with `harness session spawn --role <role> --name <name> --brief "<brief>"`.',
    ]);
  });

  it("lets herdr agent start through when its args ask for help", () => {
    expect(checkAgentStart("herdr", ["agent", "start", "--help"])).toBeNull();
    expect(checkAgentStart("herdr", ["agent", "start", "-h"])).toBeNull();
    expect(
      checkAgentStart("herdr", ["agent", "start", "w3:p2", "--help"]),
    ).toBeNull();
    expect(block).not.toHaveBeenCalled();
  });

  it("lets harness session spawn through, and every other herdr command", () => {
    const passes: [string, string[]][] = [
      ["harness", ["session", "spawn", "--role", "writer", "--name", "a"]],
      [
        "node",
        ["skills/bin/harness.mjs", "session", "spawn", "--role", "judge"],
      ],
      ["herdr", ["agent", "list"]],
      ["herdr", ["agent", "get", "w3:p2"]],
      ["herdr", ["pane", "split", "--current"]],
      ["herdr", ["agent", "send-keys", "w3:p2", "enter"]],
      ["echo", ["herdr", "agent", "start"]],
    ];

    for (const [name, args] of passes) {
      expect(checkAgentStart(name, args)).toBeNull();
    }
    expect(block).not.toHaveBeenCalled();
  });
});
