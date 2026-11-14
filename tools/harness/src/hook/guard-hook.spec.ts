import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../testing/index.js";
import { ledgerEvents } from "./feedback-support.js";
import { modeOf, INVENTORY_PATH } from "../guardrail/index.js";
import {
  committedInventory,
  committedInventoryText,
} from "../testing/index.js";
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
  tweak: (h: ReturnType<typeof testHarness>) => void = () => undefined,
  gitCalls?: (readonly string[])[],
) {
  const h = testHarness({
    env,
    files: { [`/repo/${INVENTORY_PATH}`]: committedInventoryText },
  });
  h.deps.stdin = () => Promise.resolve(stdin);
  tweak(h);
  const code = await run(["hook", "guard"], h.deps);
  gitCalls?.push(
    ...h.runner.calls.filter((c) => c.command === "git").map((c) => c.args),
  );
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
    const result = await guard(call("k3d cluster delete kore-local"));
    expect(result.code).toBe(2);
    expect(result.err).toMatch(/^\[guard:destructive\] .*Instead/);
    expect(result.out).toBe("");
    expect(
      result.events
        .filter((e) => e["kind"] !== "guard.block")
        .map((e) => [e["kind"], e["tool"], e["outcome"]]),
    ).toEqual([
      ["tool.start", "Bash", undefined],
      ["tool.end", "Bash", "failure"],
    ]);
  });

  it("records which rule blocked the call, and never the command", async () => {
    const result = await guard(
      { ...call("k3d cluster delete kore-local"), session_id: "s1" },
      {
        CLAUDE_PROJECT_DIR: "/repo",
        KORE_ROOT: "/repo",
        HERDR_PANE_ID: "w9:p9",
      },
    );
    const blocks = result.events.filter((e) => e["kind"] === "guard.block");
    expect(blocks.map((e) => [e["label"], e["session"], e["pane"]])).toEqual([
      ["destructive", "s1", "w9:p9"],
    ]);
    expect(JSON.stringify(result.events)).not.toMatch(/k3d cluster delete/);
  });

  it("asks git for the ledger root once per run, even for a block that records twice", async () => {
    const git: (readonly string[])[] = [];
    await guard(
      call("k3d cluster delete kore-local"),
      { CLAUDE_PROJECT_DIR: "/repo" },
      undefined,
      undefined,
      git,
    );
    expect(git).toHaveLength(1);
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
});

describe("hook guard faults", () => {
  it("exits 1, visibly, not 0 and not 2, when the guard itself breaks", async () => {
    const unreadable = (h: ReturnType<typeof testHarness>) => {
      h.deps.fs = {
        ...h.deps.fs,
        readFile: () =>
          Promise.reject(
            Object.assign(new Error("EACCES: permission denied"), {
              code: "EACCES",
            }),
          ),
      };
    };
    const payload = {
      tool_name: "Write",
      tool_input: {
        file_path: "/repo/infra/environments/local/environment.yaml",
        content: '"features": { "a-b": true }',
      },
    };
    const result = await guard(payload, undefined, undefined, unreadable);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toMatch(/^\[hook:guard\] failed: EACCES/);
    expect(result.err).not.toMatch(/failed open/);
  });

  it("keeps a block's verdict and stderr when the ledger cannot be written", async () => {
    const unwritable = (h: ReturnType<typeof testHarness>) => {
      const refuse = () => Promise.reject(new Error("EACCES: ledger"));
      const memory = h.deps.fs;
      h.deps.fs = {
        ...memory,
        readFile: (path) => memory.readFile(path),
        appendFile: refuse,
        writeFile: refuse,
        createFile: refuse,
      };
    };
    const normal = await guard(call("k3d cluster delete kore-local"));
    const result = await guard(
      call("k3d cluster delete kore-local"),
      undefined,
      undefined,
      unwritable,
    );
    expect(result.events).toEqual([]);
    expect(result.code).toBe(2);
    expect(result.out).toBe(normal.out);
    expect(result.err).toBe(normal.err);
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
  globMatches: () => Promise.resolve(false),
  modeOf: (rule: string) => modeOf(committedInventory, rule),
  denyRules: [],
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
      globMatches: absent.globMatches,
      modeOf: absent.modeOf,
      denyRules: [],
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

describe("hook guard, ledger events", () => {
  it("never records the tool input, only session, pane and tool", async () => {
    const result = await guard(
      {
        session_id: "s1",
        tool_name: "Grep",
        tool_input: { pattern: "hunter2" },
      },
      {
        CLAUDE_PROJECT_DIR: "/repo",
        KORE_ROOT: "/repo",
        HERDR_PANE_ID: "w9:p9",
      },
    );
    expect(result.code).toBe(0);
    const [event] = result.events;
    expect([
      event?.["kind"],
      event?.["session"],
      event?.["pane"],
      event?.["tool"],
    ]).toEqual(["tool.start", "s1", "w9:p9", "Grep"]);
    expect(JSON.stringify(result.events)).not.toMatch(/hunter2/);
  });

  it("attributes events to the idea and agent the harness stamped into the pane", async () => {
    const result = await guard(call("git status"), {
      CLAUDE_PROJECT_DIR: "/repo",
      KORE_ROOT: "/repo",
      KORE_IDEA: "#338",
      KORE_AGENT: "flow-metrics-writer",
    });
    expect(
      result.events.map((e) => [e["kind"], e["idea"], e["agent"]]),
    ).toEqual([["tool.start", "#338", "flow-metrics-writer"]]);
  });

  it("still records the event, unattributed, when the stamp is not a valid name", async () => {
    const result = await guard(call("git status"), {
      CLAUDE_PROJECT_DIR: "/repo",
      KORE_ROOT: "/repo",
      KORE_IDEA: "two words",
      KORE_AGENT: "",
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).not.toHaveProperty("idea");
    expect(result.events[0]).not.toHaveProperty("agent");
  });

  it("allows tools it has no rule for, silently, recording only their start", async () => {
    for (const tool_name of ["Task", "WebFetch", "mcp__x__y"]) {
      const result = await guard({
        session_id: "s1",
        tool_name,
        tool_input: { url: "x" },
      });
      expect(result, tool_name).toMatchObject({ code: 0, out: "", err: "" });
      expect(
        result.events.map((e) => [e["kind"], e["tool"]]),
        tool_name,
      ).toEqual([["tool.start", tool_name]]);
    }
  });
});
