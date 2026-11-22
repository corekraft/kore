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

  it("lets herdr agent start through when help is its first argument", () => {
    expect(checkAgentStart("herdr", ["agent", "start", "--help"])).toBeNull();
    expect(checkAgentStart("herdr", ["agent", "start", "-h"])).toBeNull();
    expect(block).not.toHaveBeenCalled();
  });

  it("still blocks herdr agent start when -h or --help follows other arguments", () => {
    expect(
      checkAgentStart("herdr", ["agent", "start", "w3:p2", "--help"]),
    ).toBe(BLOCKED);
    expect(
      checkAgentStart("herdr", [
        "agent",
        "start",
        "w3:p2",
        "--permission-mode",
        "bypassPermissions",
        "-h",
      ]),
    ).toBe(BLOCKED);
    expect(block).toHaveBeenCalledTimes(2);
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

const HC_BLOCKED =
  'hc run starts a claude session without the role guards, the writer host-lease refusal or the role tokens, which only harness session spawn applies. Instead, launch the session with `harness session spawn --role <role> --name <name> --brief "<brief>"`.';

describe("checkAgentStart: a bare hc launch of claude (plan 16, Step 4)", () => {
  beforeEach(() => {
    vi.mocked(block).mockReset();
    vi.mocked(block).mockReturnValue(BLOCKED);
  });

  it("blocks an hc run that starts claude, and names harness session spawn as the fix", () => {
    expect(
      checkAgentStart("hc", [
        "run",
        "--json",
        "--bg",
        "--cwd",
        ".",
        "--",
        "claude",
        "--agent",
        "reader",
        "brief",
      ]),
    ).toBe(BLOCKED);
    expect(block).toHaveBeenCalledWith("bare-agent-start-hc", HC_BLOCKED);
  });

  it("blocks a claude launch behind the harness exec wrapper, too", () => {
    expect(
      checkAgentStart("hc", [
        "run",
        "--bg",
        "--name",
        "x",
        "--",
        "harness",
        "session",
        "exec",
        "--role",
        "reader",
        "--",
        "claude",
      ]),
    ).toBe(BLOCKED);
  });

  it("lets hc help and every other hc command through", () => {
    for (const args of [
      ["run", "--help"],
      ["--help"],
      ["get", "t1"],
      ["run", "--bg", "--", "ls"],
      ["read", "t1", "--json"],
    ]) {
      expect(checkAgentStart("hc", args)).toBeNull();
    }
    expect(block).not.toHaveBeenCalled();
  });
});

describe("checkAgentStart: the argument forms of an hc launch", () => {
  beforeEach(() => {
    vi.mocked(block).mockReset();
    vi.mocked(block).mockReturnValue(BLOCKED);
  });

  it.each([
    [
      "the path to claude",
      ["run", "--bg", "--", "/usr/local/bin/claude", "--agent", "reader"],
    ],
    [
      "claude named inside a shell script",
      ["run", "--bg", "--", "sh", "-c", "exec claude --agent reader"],
    ],
    [
      "claude named inside a bash -c string",
      ["run", "--bg", "--", "bash", "-c", "'cd x && claude'"],
    ],
  ])(
    "blocks an hc run that starts claude by %s, under bare-agent-start-hc",
    (_form, args) => {
      expect(checkAgentStart("hc", args)).toBe(BLOCKED);
      expect(block).toHaveBeenCalledWith("bare-agent-start-hc", HC_BLOCKED);
    },
  );

  it("lets an hc run name a word that only contains claude", () => {
    expect(
      checkAgentStart("hc", [
        "run",
        "--bg",
        "--",
        "echo",
        "claude-code",
        "/usr/bin/claudette",
      ]),
    ).toBeNull();
  });
});
