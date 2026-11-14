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

describe("evaluate", () => {
  it("returns a role's verdict before any rule runs", async () => {
    vi.mocked(checkRole).mockReturnValue(BLOCK);
    const payload = {
      tool_name: "Bash",
      agent_type: "writer",
      tool_input: { command: "ls" },
    };
    expect(await evaluate(payload, ctx)).toBe(BLOCK);
    expect(checkRole).toHaveBeenCalledWith(
      "writer",
      "Bash",
      { command: "ls" },
      ROOT,
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
