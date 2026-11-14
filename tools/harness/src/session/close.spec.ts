import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import type { CliDeps, CommandContext, Runner } from "../runtime/index.js";
import { close } from "./close.js";
import { describeFailure, equalize } from "./equalize.js";
import { sessionNameError } from "./names.js";
import { FAILED, USAGE_ERROR, fail } from "./output.js";
import { SessionRegistry, type SessionRecord } from "./registry.js";
import { closeHint, type Worktree } from "./worktree.js";

vi.mock("./equalize.js", () => ({
  equalize: vi.fn(),
  describeFailure: vi.fn(),
}));
vi.mock("./names.js", () => ({ sessionNameError: vi.fn() }));
vi.mock("./output.js", async (original) => ({
  ...(await original<typeof import("./output.js")>()),
  fail: vi.fn(),
}));
vi.mock("./registry.js", () => ({ SessionRegistry: { open: vi.fn() } }));
vi.mock("./worktree.js", () => ({ closeHint: vi.fn() }));

/** The registry's static `open`, spied on so tests assert calls without referencing the method. */
let openRegistry: MockInstance<typeof SessionRegistry.open>;

const NOW = "2026-01-02T03:05:00.000Z";
const NOT_IN_HERDR =
  "Not inside Herdr (HERDR_ENV is not 1 or HERDR_PANE_ID is unset). Run this from the Herdr pane that spawned the session.";
const HERDR = { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p1" };
const created: SessionRecord = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const withResult: SessionRecord = {
  ...created,
  result: { outcome: "done", at: "2026-01-02T03:04:30.000Z" },
};

interface Scenario {
  record?: SessionRecord | undefined;
  env?: Record<string, string>;
  operand?: string | undefined;
  json?: boolean;
  /** What `herdr pane close` answers; success by default. */
  closeResult?: { code: number; stderr?: string };
}

/**
 * Runs `close` with a typed registry and runner. Only what close touches is
 * set; the other CliDeps fields are never read.
 */
async function runClose(scenario: Scenario) {
  const read = vi.fn<SessionRegistry["read"]>(() =>
    Promise.resolve(scenario.record),
  );
  const write = vi.fn<SessionRegistry["write"]>(() => Promise.resolve());
  openRegistry.mockResolvedValue({
    read,
    write,
  } as unknown as SessionRegistry);
  const run = vi.fn<Runner["run"]>(() =>
    Promise.resolve({
      stdout: "",
      stderr: "",
      code: 0,
      ...scenario.closeResult,
    }),
  );
  const out: string[] = [];
  const err: string[] = [];
  const context: CommandContext = {
    json: scenario.json ?? false,
    options: {},
    operand: "operand" in scenario ? scenario.operand : "image-trust-writer",
    deps: {
      runner: { run },
      clock: { now: () => new Date(NOW), sleep: vi.fn() },
      env: scenario.env ?? HERDR,
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
    } as unknown as CliDeps,
  };
  const code = await close(context);
  return { code, run, read, write, out, err, context };
}

/** The message `fail` was given: its code and its text. */
const failure = () => {
  const call = vi.mocked(fail).mock.calls[0];
  return { code: call?.[2], message: call?.[3] };
};

beforeEach(() => {
  openRegistry = vi.spyOn(SessionRegistry, "open");
  vi.mocked(sessionNameError).mockReturnValue(undefined);
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
  vi.mocked(equalize).mockResolvedValue({ status: "equalized" });
  vi.mocked(describeFailure).mockImplementation((result) => result.stderr);
  vi.mocked(closeHint).mockReturnValue("Remove the worktree with git.");
});

describe("session close refuses before it touches Herdr or the registry", () => {
  it("fails with the usage line when no session name is given", async () => {
    const c = await runClose({ operand: undefined });
    expect(c.code).toBe(USAGE_ERROR);
    expect(failure()).toEqual({
      code: USAGE_ERROR,
      message: "Missing the session name: session close <name>.",
    });
    expect(openRegistry).not.toHaveBeenCalled();
  });

  it("returns the name error from validation and never opens the registry", async () => {
    vi.mocked(sessionNameError).mockReturnValue("Session name is bad.");
    const c = await runClose({ operand: "Bad Name" });
    expect(c.code).toBe(USAGE_ERROR);
    expect(failure().message).toBe("Session name is bad.");
    expect(c.run).not.toHaveBeenCalled();
    expect(openRegistry).not.toHaveBeenCalled();
  });

  it("refuses outside Herdr, and calls nothing", async () => {
    const c = await runClose({ env: {} });
    expect(c.code).toBe(FAILED);
    expect(failure()).toEqual({ code: FAILED, message: NOT_IN_HERDR });
    expect(c.run).not.toHaveBeenCalled();
    expect(openRegistry).not.toHaveBeenCalled();
  });

  it("refuses a session this tool did not create, closing no pane", async () => {
    const c = await runClose({ record: undefined });
    expect(c.code).toBe(FAILED);
    expect(failure().message).toBe(
      "This tool did not create a session named image-trust-writer, so it will not close one. Close it yourself with `herdr pane close <pane-id>` if you are sure.",
    );
    expect(c.run).not.toHaveBeenCalled();
  });
});

describe("session close refuses a session it may not close", () => {
  it("refuses a session already closed, naming its pane", async () => {
    const c = await runClose({
      record: { ...withResult, closedAt: "2026-01-02T03:04:50.000Z" },
    });
    expect(c.code).toBe(FAILED);
    expect(failure().message).toBe(
      "Session image-trust-writer is already closed (pane w3:p9).",
    );
    expect(c.run).not.toHaveBeenCalled();
  });

  it("refuses a pane other than the one that spawned the session", async () => {
    const c = await runClose({
      record: withResult,
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p77" },
    });
    expect(c.code).toBe(FAILED);
    expect(failure().message).toBe(
      "Session image-trust-writer was spawned from pane w3:p1, not w3:p77; only that pane may close it.",
    );
    expect(c.run).not.toHaveBeenCalled();
  });

  it("refuses a session with no recorded result, pointing at session wait", async () => {
    const c = await runClose({ record: created });
    expect(c.code).toBe(FAILED);
    expect(failure().message).toBe(
      "Session image-trust-writer has no recorded result, so pane w3:p9 stays open. Run `session wait image-trust-writer` first.",
    );
    expect(c.run).not.toHaveBeenCalled();
    expect(c.write).not.toHaveBeenCalled();
  });
});

describe("session close closes the pane and records it", () => {
  it("closes the pane, records the close time from the clock, then equalizes from the caller's pane", async () => {
    const c = await runClose({ record: withResult });
    expect(c.code).toBe(0);
    expect(c.run.mock.calls).toEqual([["herdr", ["pane", "close", "w3:p9"]]]);
    expect(c.write.mock.calls).toEqual([[{ ...withResult, closedAt: NOW }]]);
    expect(equalize).toHaveBeenCalledWith(c.context.deps.runner, "w3:p1");
    expect(c.out).toEqual(["Closed image-trust-writer (pane w3:p9).\n"]);
  });

  it("prints the closed session as one JSON object with --json", async () => {
    const c = await runClose({ record: withResult, json: true });
    expect(c.out).toEqual([
      '{"name":"image-trust-writer","paneId":"w3:p9","closed":true,"equalize":{"status":"equalized"}}\n',
    ]);
  });

  it("prints the worktree hint, and includes it in the JSON, when the session had a worktree", async () => {
    const worktree: Worktree = {
      path: "/main/.claude/worktrees/x",
      branch: "feat/x",
    };
    const c = await runClose({
      record: { ...withResult, worktree },
      json: true,
    });
    expect(closeHint).toHaveBeenCalledWith(worktree);
    expect(JSON.parse(c.out.join(""))).toMatchObject({
      hint: "Remove the worktree with git.",
    });
  });

  it("prints no hint for a session without a worktree", async () => {
    const c = await runClose({ record: withResult, json: true });
    expect(closeHint).not.toHaveBeenCalled();
    expect(JSON.parse(c.out.join(""))).not.toHaveProperty("hint");
  });

  it("notes a failed equalize on stderr but still reports the close and exits 0", async () => {
    vi.mocked(equalize).mockResolvedValue({
      status: "failed",
      reason: "layout gone",
    });
    const c = await runClose({ record: withResult });
    expect(c.code).toBe(0);
    expect(c.write).toHaveBeenCalledTimes(1);
    expect(c.err).toEqual(["Closed, but equalizing failed: layout gone\n"]);
    expect(c.out).toEqual(["Closed image-trust-writer (pane w3:p9).\n"]);
  });
});

describe("session close keeps the session open when herdr refuses", () => {
  it("reports herdr's message, names the pane, and does not record the close", async () => {
    const c = await runClose({
      record: withResult,
      closeResult: { code: 1, stderr: "pane_not_found" },
    });
    expect(c.code).toBe(FAILED);
    expect(failure().message).toBe(
      "herdr pane close w3:p9 failed: pane_not_found",
    );
    expect(c.write).not.toHaveBeenCalled();
    expect(equalize).not.toHaveBeenCalled();
  });
});
