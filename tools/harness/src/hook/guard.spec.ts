// The guard hook entry: records the call, decides it, and turns the verdict into the host's output. The evaluator, inventory, ledger and hash are mocked.

import { createHash, type Hash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import {
  denyRules,
  findInventory,
  GuardrailError,
  modeOf,
  type Inventory,
} from "../guardrail/index.js";
import { asCall, evaluate, type GuardCall } from "./guard-evaluate.js";
import { guard } from "./guard.js";
import { hostFacts } from "./guard-host-shell.js";
import { launchRoot } from "./guard-launch-root.js";
import { recordEvent } from "./ledger-event.js";
import { allow, block, type Verdict } from "./guard-verdict.js";

vi.mock("node:crypto", () => ({ createHash: vi.fn() }));
vi.mock("../guardrail/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../guardrail/index.js")>()),
  denyRules: vi.fn(),
  findInventory: vi.fn(),
  modeOf: vi.fn(),
}));
vi.mock("./guard-evaluate.js", () => ({ asCall: vi.fn(), evaluate: vi.fn() }));
vi.mock("./guard-host-shell.js", () => ({ hostFacts: vi.fn() }));
vi.mock("./guard-launch-root.js", () => ({ launchRoot: vi.fn() }));
vi.mock("./ledger-event.js", () => ({ recordEvent: vi.fn() }));

/** The one assertion: a fake's parts as CliDeps, whose members the unit never reads. */
const asCliDeps = (parts: object) => parts as CliDeps;
/** The one assertion: a hash fake with the two members the guard reads, as a Hash. */
const asHash = (parts: object) => parts as Hash;
/** A hash whose digest is fixed; update returns the same hash, as the real one does. */
const fakeHash = (digest: string) => {
  const hash = { update: () => hash, digest: () => digest };
  return asHash(hash);
};

const CALL: GuardCall = {
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command: "git push" },
};
const EMPTY: Inventory = { guardrails: [] };

/** Typed CliDeps for one run: the env and cwd the root comes from, and a file system whose reads are mocks. */
function fakeDeps(
  env: Record<string, string> = {
    CLAUDE_PROJECT_DIR: "/repo",
    HOME: "/home/test",
  },
) {
  const fs = {
    readFile: vi.fn((_path: string) => Promise.resolve("")),
    hasGlobMatch: vi.fn((_dir: string, _pattern: string) =>
      Promise.resolve(false),
    ),
  };
  return { deps: asCliDeps({ env, cwd: "/cwd", fs }), fs };
}

beforeEach(() => {
  vi.mocked(asCall).mockReturnValue(CALL);
  vi.mocked(evaluate).mockResolvedValue(allow);
  vi.mocked(findInventory).mockResolvedValue(EMPTY);
  vi.mocked(modeOf).mockReturnValue("enforce");
  vi.mocked(denyRules).mockReturnValue([]);
  vi.mocked(recordEvent).mockResolvedValue(undefined);
  vi.mocked(launchRoot).mockResolvedValue("/repo");
  vi.mocked(hostFacts).mockResolvedValue({
    home: "/home/test",
    verifiedBash: false,
  });
  vi.mocked(createHash).mockReturnValue(fakeHash("0123456789abcdef9999"));
});

describe("guard entry", () => {
  it("passes an absent payload through: no verdict, nothing recorded", async () => {
    const { deps } = fakeDeps();
    expect(await guard(undefined, deps)).toEqual({});
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("allows a call the rules allow, with the start recorded and no output", async () => {
    const { deps } = fakeDeps();
    expect(await guard({}, deps)).toEqual({});
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith(
      deps,
      "tool.start",
      CALL,
      undefined,
      {},
    );
  });

  it("records the start of a background command as background, so the stall check can leave its pane out", async () => {
    const { deps } = fakeDeps();
    const background: GuardCall = {
      ...CALL,
      tool_input: { command: "npm test", run_in_background: true },
    };
    vi.mocked(asCall).mockReturnValue(background);
    await guard({}, deps);
    expect(recordEvent).toHaveBeenCalledWith(
      deps,
      "tool.start",
      background,
      undefined,
      {
        background: true,
      },
    );
  });

  it("records a foreground call without a background mark, even when run_in_background is false", async () => {
    const { deps } = fakeDeps();
    vi.mocked(asCall).mockReturnValue({
      ...CALL,
      tool_input: { command: "npm test", run_in_background: false },
    });
    await guard({}, deps);
    expect(recordEvent).toHaveBeenCalledWith(
      deps,
      "tool.start",
      expect.anything(),
      undefined,
      {},
    );
  });

  it("takes the root from the launch root, asked with the call's directory, then the deps cwd", async () => {
    const { deps } = fakeDeps();
    vi.mocked(launchRoot).mockResolvedValue("/top");
    await guard({}, deps);
    expect(launchRoot).toHaveBeenLastCalledWith(deps, "/cwd");
    expect(findInventory).toHaveBeenLastCalledWith(
      expect.any(Function),
      "/top",
    );
    vi.mocked(asCall).mockReturnValue({ ...CALL, cwd: "/work" });
    await guard({}, deps);
    expect(launchRoot).toHaveBeenLastCalledWith(deps, "/work");
  });
});

describe("guard verdict output", () => {
  it("blocks with exit 2, names the rule, and records the failed end and the block", async () => {
    vi.mocked(evaluate).mockResolvedValue(
      block("secret-path", "read it by hand"),
    );
    const { deps } = fakeDeps();
    expect(await guard({}, deps)).toEqual({
      code: 2,
      stderr: "[guard:secret-path] read it by hand\n",
    });
    expect(recordEvent).toHaveBeenCalledWith(deps, "tool.end", CALL, "failure");
    expect(recordEvent).toHaveBeenCalledWith(
      deps,
      "guard.block",
      CALL,
      undefined,
      {
        label: "secret-path",
        id: "guard.block:s1:secret-path:0123456789abcdef",
      },
    );
  });

  it("warns with the host's additional context, and records one audit event per rule", async () => {
    const verdict: Verdict = {
      action: "warn",
      rule: "image-digest",
      message: "[guard:image-digest] pin it",
      rules: ["image-digest", "append-only"],
    };
    vi.mocked(evaluate).mockResolvedValue(verdict);
    const { deps } = fakeDeps();
    expect(await guard({}, deps)).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: "[guard:image-digest] pin it",
        },
      }),
    });
    expect(recordEvent).toHaveBeenCalledWith(
      deps,
      "guard.audit",
      CALL,
      undefined,
      { label: "image-digest" },
    );
    expect(recordEvent).toHaveBeenCalledWith(
      deps,
      "guard.audit",
      CALL,
      undefined,
      { label: "append-only" },
    );
  });
});

describe("guard verdict fallbacks", () => {
  it("hashes a call with no tool input, and records a warning with no rule list under its own rule", async () => {
    vi.mocked(asCall).mockReturnValue({ session_id: "s1", tool_name: "Bash" });
    vi.mocked(evaluate).mockResolvedValue(block("secret-path", "stop"));
    await guard({}, fakeDeps().deps);
    expect(recordEvent).toHaveBeenCalledWith(
      expect.anything(),
      "guard.block",
      expect.anything(),
      undefined,
      expect.objectContaining({ label: "secret-path" }),
    );
    const warning: Verdict = {
      action: "warn",
      rule: "image-digest",
      message: "w",
    };
    vi.mocked(evaluate).mockResolvedValue(warning);
    await guard({}, fakeDeps().deps);
    expect(recordEvent).toHaveBeenCalledWith(
      expect.anything(),
      "guard.audit",
      expect.anything(),
      undefined,
      { label: "image-digest" },
    );
  });
});

describe("guard inventory", () => {
  it("enforces every rule and says why when the inventory cannot be read", async () => {
    vi.mocked(findInventory).mockRejectedValue(
      new GuardrailError("the file is invalid"),
    );
    vi.mocked(evaluate).mockResolvedValue(block("bare-glob", "stop"));
    const result = await guard({}, fakeDeps().deps);
    expect(result).toEqual({
      code: 2,
      stderr:
        "[guard:bare-glob] stop\n[guard] Every rule is enforcing because the file is invalid\n",
    });
    const ctx = vi.mocked(evaluate).mock.calls[0]?.[1];
    expect(ctx?.modeOf("append-only")).toBe("enforce");
    expect(ctx?.denyRules).toEqual([]);
  });

  it("fails the hook for an error that is not about the inventory", async () => {
    vi.mocked(findInventory).mockRejectedValue(new Error("disk gone"));
    await expect(guard({}, fakeDeps().deps)).rejects.toThrow("disk gone");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("gives the rules the inventory's modes and deny list, and reads globs from the call's directory", async () => {
    vi.mocked(findInventory).mockResolvedValue(EMPTY);
    vi.mocked(modeOf).mockReturnValue("audit");
    vi.mocked(asCall).mockReturnValue({ ...CALL, cwd: "/work" });
    const { deps, fs } = fakeDeps();
    await guard({}, deps);
    const ctx = vi.mocked(evaluate).mock.calls[0]?.[1];
    expect(ctx?.modeOf("append-only")).toBe("audit");
    expect(modeOf).toHaveBeenCalledWith(EMPTY, "append-only");
    expect(denyRules).toHaveBeenCalledWith(EMPTY);
    await ctx?.globMatches("*.ts");
    expect(fs.hasGlobMatch).toHaveBeenCalledWith("/work", "*.ts");
  });

  it("gives the rules the home directory and the verified shell that the host check answers for the hook's environment", async () => {
    vi.mocked(findInventory).mockResolvedValue(EMPTY);
    const env = { CLAUDE_PROJECT_DIR: "/repo", HOME: "/home/test" };
    vi.mocked(hostFacts).mockResolvedValue({
      home: "/answered",
      verifiedBash: true,
    });
    const { deps } = fakeDeps(env);
    await guard({}, deps);
    expect(hostFacts).toHaveBeenCalledWith(env, deps.fs, "/repo");
    const ctx = vi.mocked(evaluate).mock.calls[0]?.[1];
    expect(ctx?.home).toBe("/answered");
    expect(ctx?.verifiedBash).toBe(true);
  });

  it("does not verify bash when the host check does not", async () => {
    vi.mocked(findInventory).mockResolvedValue(EMPTY);
    await guard({}, fakeDeps().deps);
    expect(vi.mocked(evaluate).mock.calls[0]?.[1].verifiedBash).toBe(false);
  });

  it("reads a glob from the directory the rule names, and the call's directory when it names none", async () => {
    vi.mocked(findInventory).mockResolvedValue(EMPTY);
    vi.mocked(asCall).mockReturnValue({ ...CALL, cwd: "/work" });
    const { deps, fs } = fakeDeps();
    await guard({}, deps);
    const ctx = vi.mocked(evaluate).mock.calls[0]?.[1];
    expect(ctx?.cwd).toBe("/work");
    await ctx?.globMatches("*.md", "/work/sub");
    expect(fs.hasGlobMatch).toHaveBeenLastCalledWith("/work/sub", "*.md");
    await ctx?.globMatches("*.md");
    expect(fs.hasGlobMatch).toHaveBeenLastCalledWith("/work", "*.md");
  });
});
