// The guard's dispatch: role bounds first, then Bash or file rules, else allow. The role check and both rule sets are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { asCall, evaluate } from "./guard-evaluate.js";
import { evaluateBash } from "./guard-bash.js";
import { evaluateFile } from "./guard-file.js";
import { checkRole } from "./guard-role.js";
import {
  allow,
  block,
  type GuardContext,
  type Verdict,
} from "./guard-verdict.js";

vi.mock("./guard-bash.js", () => ({ evaluateBash: vi.fn() }));
vi.mock("./guard-file.js", () => ({ evaluateFile: vi.fn() }));
vi.mock("./guard-role.js", () => ({ checkRole: vi.fn() }));

const ROOT = "/repo";
const ctx: GuardContext = {
  root: ROOT,
  readFile: () => Promise.reject(new Error("no file in this unit")),
  cwd: ROOT,
  home: "/home/test",
  globMatches: () => Promise.resolve(false),
  modeOf: () => "enforce",
  denyRules: [],
};
const BLOCK: Verdict = block("bare-agent-start", "stop");

beforeEach(() => {
  vi.mocked(checkRole).mockReturnValue(null);
  vi.mocked(evaluateBash).mockResolvedValue(allow);
  vi.mocked(evaluateFile).mockResolvedValue(allow);
});

describe("asCall", () => {
  it("passes an object payload through and reads nothing from anything else", () => {
    const call = { tool_name: "Bash" };
    expect(asCall(call)).toBe(call);
    expect(asCall(null)).toEqual({});
    expect(asCall("Bash")).toEqual({});
  });
});

describe("evaluate: the help exemption reaches the role bounds", () => {
  it("hands gated-help-exempt to the role bounds, so a writer's help request is judged with the flag", async () => {
    vi.mocked(checkRole).mockReturnValue(null);
    const payload = {
      tool_name: "Bash",
      agent_type: "writer",
      tool_input: {
        command: "node skills/bin/harness.mjs flag activate --help",
      },
    };
    await evaluate(payload, { ...ctx, helpExempt: true });
    expect(checkRole).toHaveBeenCalledWith(
      "writer",
      "Bash",
      { command: "node skills/bin/harness.mjs flag activate --help" },
      ROOT,
      { cwd: ROOT, helpExempt: true },
    );
  });
});

describe("evaluate", () => {
  it("returns a role's verdict before any rule runs", async () => {
    vi.mocked(checkRole).mockReturnValue(BLOCK);
    const payload = {
      tool_name: "Bash",
      agent_type: "writer",
      tool_input: { command: "ls" },
    };
    const deep = { ...ctx, cwd: `${ROOT}/tools/harness` };
    expect(await evaluate(payload, deep)).toBe(BLOCK);
    expect(checkRole).toHaveBeenCalledWith(
      "writer",
      "Bash",
      { command: "ls" },
      ROOT,
      { cwd: `${ROOT}/tools/harness`, helpExempt: false },
    );
    expect(evaluateBash).not.toHaveBeenCalled();
  });

  it("sends a Bash command to the Bash rules with the context", async () => {
    vi.mocked(evaluateBash).mockResolvedValue(BLOCK);
    const payload = { tool_name: "Bash", tool_input: { command: "git push" } };
    expect(await evaluate(payload, ctx)).toBe(BLOCK);
    expect(evaluateBash).toHaveBeenCalledWith("git push", ctx);
  });

  it("sends an edit under the root to the file rules with its path made relative", async () => {
    const input = { file_path: `${ROOT}/tools/x.ts`, new_string: "a" };
    await evaluate({ tool_name: "Edit", tool_input: input }, ctx);
    expect(evaluateFile).toHaveBeenCalledWith("Edit", input, "tools/x.ts", ctx);
  });

  it("keeps a path outside the root as it is given", async () => {
    await evaluate(
      { tool_name: "Read", tool_input: { file_path: "/etc/hosts" } },
      ctx,
    );
    expect(evaluateFile).toHaveBeenCalledWith(
      "Read",
      { file_path: "/etc/hosts" },
      "/etc/hosts",
      ctx,
    );
  });

  it("allows a call the rules do not read: a Bash call with no command, a write with no path, another tool", async () => {
    expect(await evaluate({ tool_name: "Bash", tool_input: {} }, ctx)).toEqual(
      allow,
    );
    expect(
      await evaluate({ tool_name: "Write", tool_input: { content: "x" } }, ctx),
    ).toEqual(allow);
    expect(
      await evaluate({ tool_name: "Glob", tool_input: { pattern: "*" } }, ctx),
    ).toEqual(allow);
    expect(evaluateBash).not.toHaveBeenCalled();
    expect(evaluateFile).not.toHaveBeenCalled();
  });

  it("allows a payload that is not an object, without asking the role or the rules", async () => {
    expect(await evaluate(undefined, ctx)).toEqual(allow);
    expect(checkRole).not.toHaveBeenCalled();
  });
});

describe("evaluate: the role the context names", () => {
  const write = {
    tool_name: "Write",
    agent_type: "writer",
    tool_input: { file_path: "a.md" },
  };

  it("checks the role its session record names, over the payload's agent_type", async () => {
    vi.mocked(checkRole).mockReturnValue(null);

    await evaluate(write, { ...ctx, role: "reader" });

    expect(vi.mocked(checkRole).mock.calls[0]?.[0]).toBe("reader");
  });

  it("checks the payload's agent_type when the context names no role", async () => {
    vi.mocked(checkRole).mockReturnValue(null);

    await evaluate(write, ctx);

    expect(vi.mocked(checkRole).mock.calls[0]?.[0]).toBe("writer");
  });
});
