import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import { ledgerEvents } from "./feedback-support.js";
import { evaluate } from "./guard.js";

// The hook as the host runs it, in process: exit code, stdout, stderr and the
// ledger events it records beside the verdict.
async function guard(
  payload: unknown,
  env: Record<string, string> = {
    CLAUDE_PROJECT_DIR: "/repo",
    KORE_ROOT: "/repo",
  },
  stdin = JSON.stringify(payload),
) {
  const h = testHarness({ env });
  h.deps.stdin = () => Promise.resolve(stdin);
  const code = await run(["hook", "guard"], h.deps);
  return {
    code,
    out: h.out(),
    err: h.err(),
    events: ledgerEvents(h.files),
  };
}

const call = (command: string) => ({
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command },
});

describe("hook guard", () => {
  it("blocks with exit 2 and records a tool start and a failed tool end", async () => {
    const result = await guard(call("minikube delete"));
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^\[guard:destructive\] .*Instead/);
    expect(result.out).toBe("");
    expect(
      result.events.map((e) => [e["kind"], e["tool"], e["outcome"]]),
    ).toEqual([
      ["tool.start", "Bash", undefined],
      ["tool.end", "Bash", "failure"],
    ]);
  });

  it("allows silently and records only the tool start", async () => {
    const result = await guard(call("git status"));
    expect(result).toMatchObject({ code: 0, out: "", err: "" });
    expect(result.events.map((e) => e["kind"])).toEqual(["tool.start"]);
  });

  it("warns through additionalContext with exit 0, taking the root from the payload's cwd", async () => {
    const result = await guard(
      {
        tool_name: "Write",
        cwd: "/repo",
        tool_input: {
          file_path: "/repo/apps/web/d.yaml",
          content: "image: web:1\n",
        },
      },
      { KORE_ROOT: "/repo" },
    );
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(JSON.parse(result.out).hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      additionalContext: expect.stringMatching(/guard:image-digest/),
    });
    expect(result.events).toEqual([]);
  });

  it("fails open on malformed input, empty input and a payload that is not an object", async () => {
    for (const stdin of ["not json", "", "null", "42"]) {
      const result = await guard(undefined, undefined, stdin);
      expect(result, stdin).toMatchObject({ code: 0, out: "", err: "" });
    }
  });
});

const absent = {
  root: "/repo",
  readFile: () =>
    Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
};

describe("guard evaluation edges", () => {
  it("passes a write when the repository has no .sops.yaml", async () => {
    const verdict = await evaluate(
      {
        tool_name: "Write",
        tool_input: {
          file_path: "/repo/infra/environments/local/secrets/db.enc.yaml",
          content: "a: b\n",
        },
      },
      absent,
    );
    expect(verdict.action).toBe("allow");
  });

  it("rethrows an unexpected read error so the hook fails open with its cause", async () => {
    const denied = {
      root: "/repo",
      readFile: () =>
        Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" })),
    };
    await expect(
      evaluate(
        {
          tool_name: "Write",
          tool_input: {
            file_path: "/repo/infra/environments/local/environment.yaml",
            content: '"features": { "a-b": true }',
          },
        },
        denied,
      ),
    ).rejects.toThrow("EACCES");
  });

  it("passes a bare wrapper and an escaped quote inside double quotes", async () => {
    for (const command of ["sudo", 'echo "a\\"b"', 'echo "a\\"b" *']) {
      const verdict = await evaluate(
        { tool_name: "Bash", tool_input: { command } },
        absent,
      );
      expect(verdict.action, command).not.toBe("block");
    }
  });
});
