// The status line, ported from .claude/hooks/statusline.test.mjs.
// Plan: infra/plans/3-agent-harness.md (Step 9)

import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../testing/index.js";
import { nextStep } from "../plan/index.js";
import { contextPercent, statusLine } from "./statusline.js";

const AMBER = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const plan = `# Plan

## Step 8: Earlier

- [ ] Confirm live.

## Step 9: Operator Load

Next: wire the statusline.

- [ ] Statusline.
- [x] Brief.
`;

const plans = { "3-agent-harness.md": plan, "1-old.md": "- [x] done\n" };

describe("contextPercent", () => {
  it("prefers the reported percentage and falls back to the current usage", () => {
    expect(contextPercent({ context_window: { used_percentage: 41.6 } })).toBe(
      42,
    );
    expect(
      contextPercent({
        context_window: {
          context_window_size: 200000,
          current_usage: {
            input_tokens: 50000,
            cache_creation_input_tokens: 10000,
            cache_read_input_tokens: 40000,
          },
        },
      }),
    ).toBe(50);
    expect(contextPercent({})).toBeNull();
    expect(
      contextPercent({
        context_window: { current_usage: { input_tokens: 1 } },
      }),
    ).toBeNull();
  });

  it("counts a missing usage field as zero", () => {
    expect(
      contextPercent({
        context_window: { context_window_size: 100, current_usage: {} },
      }),
    ).toBe(0);
  });
});

describe("statusLine", () => {
  it("shows context use, the active plan, its Next: step, and open items", () => {
    expect(statusLine({ context_window: { used_percentage: 12 } }, plans)).toBe(
      "ctx 12% · 3-agent-harness · Step 9 · 2 open",
    );
  });

  it("turns context use amber at 40% and red at 50%, and leaves it plain below", () => {
    const at = (used_percentage: number) =>
      statusLine({ context_window: { used_percentage } }, {});
    expect(at(39)).toBe("ctx 39%");
    expect(at(40)).toBe(`${AMBER}ctx 40%${RESET}`);
    expect(at(50)).toBe(`${RED}ctx 50%${RESET}`);
  });

  it("omits what it cannot know instead of guessing", () => {
    expect(statusLine({}, {})).toBe("");
    expect(
      statusLine({}, { "2-plan.md": "## Step 1: A\n\n- [ ] open\n" }),
    ).toBe("2-plan · 1 open");
  });

  it("reads Next: as the session brief does, ending it at a list item", () => {
    const tight = "## Step 4: Tight\nNext: do it\n- [ ] item\n";
    expect(nextStep(tight)?.text).toBe("do it");
    expect(statusLine({}, { "2-plan.md": tight })).toBe(
      "2-plan · Step 4 · 1 open",
    );
  });

  it("names the plan the brief names: the highest-numbered active one", () => {
    const active = (n: number) =>
      `---\nstatus: active\nsummary: A plan.\nlast-verified: 2026-11-07\n---\n\n## Step ${n}: S\n\n- [ ] open\n`;
    expect(statusLine({}, { "2-a.md": active(1), "10-b.md": active(2) })).toBe(
      "10-b · 1 open",
    );
  });
});

async function runWith(
  stdin: string,
  files: Record<string, string> = {},
  env: Record<string, string> = {},
) {
  const h = testHarness({ files, env });
  h.deps.stdin = () => Promise.resolve(stdin);
  const code = await run(["hook", "statusline"], h.deps);
  return { code, out: h.out(), err: h.err() };
}

describe("hook statusline", () => {
  it("prints one line from the session JSON and the plans under the project", async () => {
    const result = await runWith(
      JSON.stringify({
        workspace: { project_dir: "/repo" },
        context_window: { used_percentage: 20 },
      }),
      { "/repo/infra/plans/3-agent-harness.md": plan },
    );
    expect(result).toEqual({
      code: 0,
      out: "ctx 20% · 3-agent-harness · Step 9 · 2 open\n",
      err: "",
    });
  });

  it("prints nothing for malformed or non-object input and exits cleanly", async () => {
    for (const stdin of ["not json", "", "[1]", "null", "7"]) {
      expect(await runWith(stdin)).toEqual({ code: 0, out: "", err: "" });
    }
  });

  it("prints nothing when it knows nothing", async () => {
    expect(await runWith("{}")).toEqual({ code: 0, out: "", err: "" });
  });
});

describe("hook statusline, in any project", () => {
  const used = (extra: object = {}) =>
    JSON.stringify({ context_window: { used_percentage: 20 }, ...extra });
  const planAt = (root: string) => ({
    [`${root}/infra/plans/3-agent-harness.md`]: plan,
  });
  const LINE = "ctx 20% · 3-agent-harness · Step 9 · 2 open\n";

  it("takes the project from CLAUDE_PROJECT_DIR, then workspace.project_dir, then cwd", async () => {
    const files = { ...planAt("/env"), ...planAt("/ws"), ...planAt("/cwd") };
    const both = used({ workspace: { project_dir: "/ws" }, cwd: "/cwd" });
    expect(
      (await runWith(both, files, { CLAUDE_PROJECT_DIR: "/env" })).out,
    ).toBe(LINE);
    expect((await runWith(both, planAt("/ws"))).out).toBe(LINE);
    expect((await runWith(used({ cwd: "/cwd" }), planAt("/cwd"))).out).toBe(
      LINE,
    );
    // Not the repository the bundle sits in, which holds /repo/infra/plans.
    expect(
      (
        await runWith(
          used({ workspace: { project_dir: "/other" } }),
          planAt("/repo"),
        )
      ).out,
    ).toBe("ctx 20%\n");
  });

  it("still prints context use in a project without infra/plans", async () => {
    const result = await runWith(
      used({ workspace: { project_dir: "/none" } }),
      {},
      {
        CLAUDE_PROJECT_DIR: "/also-none",
      },
    );
    expect(result).toEqual({ code: 0, out: "ctx 20%\n", err: "" });
  });

  it("shows a short marker on stdout when the plans cannot be read", async () => {
    const h = testHarness({ env: { CLAUDE_PROJECT_DIR: "/p" } });
    h.deps.stdin = () => Promise.resolve(used());
    h.deps.fs = {
      ...h.deps.fs,
      readdir: () =>
        Promise.reject(Object.assign(new Error("no"), { code: "EACCES" })),
    };
    expect(await run(["hook", "statusline"], h.deps)).toBe(0);
    expect(h.out()).toBe("ctx 20% · plans?\n");
    expect(h.err()).toBe("");
  });
});
