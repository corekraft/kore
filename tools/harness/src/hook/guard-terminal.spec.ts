// The guard for a call in an hc terminal: the role its session record names reaches the evaluator, and a notice about
// an unreadable record reaches the agent (plan 16, Grilled Decisions 5). The collaborators are mocked, as in guard.spec.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import {
  denyRules,
  findInventory,
  modeOf,
  type Inventory,
} from "../guardrail/index.js";
import { asCall, evaluate, type GuardCall } from "./guard-evaluate.js";
import { guard } from "./guard.js";
import {
  hostFacts,
  terminalNotice,
  terminalRoleFacts,
} from "./guard-host-shell.js";
import { launchRoot } from "./guard-launch-root.js";
import { recordEvent } from "./ledger-event.js";
import { allow, block } from "./guard-verdict.js";

vi.mock("../guardrail/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guardrail/index.js")>()),
  denyRules: vi.fn(),
  findInventory: vi.fn(),
  modeOf: vi.fn(),
}));
vi.mock("./guard-evaluate.js", () => ({ asCall: vi.fn(), evaluate: vi.fn() }));
vi.mock("./guard-host-shell.js", () => ({
  helpExemptOn: vi.fn(),
  hostFacts: vi.fn(),
  terminalNotice: vi.fn(),
  terminalRoleFacts: vi.fn(),
}));
vi.mock("./guard-launch-root.js", () => ({ launchRoot: vi.fn() }));
vi.mock("./ledger-event.js", () => ({ recordEvent: vi.fn() }));

/** The one assertion: a fake's parts as CliDeps, whose members the unit never reads. */
const asCliDeps = (parts: object) => parts as CliDeps;

const CALL: GuardCall = {
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command: "git push" },
};
const EMPTY: Inventory = { guardrails: [] };
const NOTICE = "\n[guard] The session record a.json cannot be read";

/** Deps for one hc terminal run: the environment names the terminal, and the file system reads nothing. */
function hcTerminalDeps(): CliDeps {
  const fs = {
    readFile: vi.fn((_path: string) => Promise.resolve("")),
    hasGlobMatch: vi.fn((_dir: string, _pattern: string) =>
      Promise.resolve(false),
    ),
  };
  return asCliDeps({
    env: {
      CLAUDE_PROJECT_DIR: "/repo",
      HOME: "/home/test",
      HC_TERMINAL_ID: "t7",
    },
    cwd: "/cwd",
    fs,
  });
}

beforeEach(() => {
  vi.mocked(asCall).mockReturnValue(CALL);
  vi.mocked(evaluate).mockResolvedValue(allow);
  vi.mocked(findInventory).mockResolvedValue(EMPTY);
  vi.mocked(modeOf).mockReturnValue("enforce");
  vi.mocked(denyRules).mockReturnValue([]);
  vi.mocked(recordEvent).mockResolvedValue(undefined);
  vi.mocked(terminalRoleFacts).mockResolvedValue({});
  vi.mocked(terminalNotice).mockResolvedValue("");
  vi.mocked(launchRoot).mockResolvedValue("/repo");
  vi.mocked(hostFacts).mockResolvedValue({
    home: "/home/test",
    verifiedBash: false,
  });
});

describe("guard: the role its session record names", () => {
  it("hands the evaluator the role an hc terminal's record names", async () => {
    vi.mocked(terminalRoleFacts).mockResolvedValue({ role: "reader" });

    await guard({}, hcTerminalDeps());

    expect(vi.mocked(evaluate).mock.calls[0]?.[1]).toMatchObject({
      role: "reader",
    });
  });
});

describe("guard: the notice of an hc terminal whose own record cannot be read", () => {
  it("adds the notice after a block's reason", async () => {
    vi.mocked(terminalNotice).mockResolvedValue(NOTICE);
    vi.mocked(evaluate).mockResolvedValue(
      block("secret-path", "read it by hand"),
    );

    expect(await guard({}, hcTerminalDeps())).toEqual({
      code: 2,
      stderr: "[guard:secret-path] read it by hand" + NOTICE + "\n",
    });
  });

  it("adds the notice to an allowed call, as additional context", async () => {
    vi.mocked(terminalNotice).mockResolvedValue(NOTICE);

    expect(await guard({}, hcTerminalDeps())).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: "[guard] The session record a.json cannot be read",
        },
      }),
    });
  });
});
