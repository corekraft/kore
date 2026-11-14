import { describe, expect, it } from "vitest";
import { testHarness } from "../testing/index.js";
import { run } from "../cli/index.js";
import {
  INSIDE,
  gitCommon,
  herdrCalls,
  layoutOf,
  stateFile,
} from "./spawn-support.js";

const created = {
  name: "image-trust-writer",
  paneId: "w3:p9",
  callerPane: "w3:p1",
  model: "claude-sonnet-5-5",
  role: "writer",
  effort: "high",
  createdAt: "2026-01-02T03:04:05.000Z",
};
const withResult = {
  ...created,
  result: { outcome: "done", at: "2026-01-02T03:05:00.000Z" },
};
const close = ["session", "close", "image-trust-writer", "--json"];
const stateOf = (record: object) => ({
  [stateFile("image-trust-writer")]: JSON.stringify(record),
});
const closes = (h: ReturnType<typeof testHarness>) =>
  herdrCalls(h).filter((c) => c.includes("pane close"));

describe("session close", () => {
  it("closes a pane this caller created once its result is recorded, then equalizes", async () => {
    const h = testHarness({
      env: INSIDE,
      files: stateOf(withResult),
      responses: [gitCommon, layoutOf()],
    });
    expect(await run(close, h.deps)).toBe(0);
    const calls = herdrCalls(h);
    expect(calls).toContain("herdr pane close w3:p9");
    expect(calls.indexOf("herdr pane layout --pane w3:p1")).toBeGreaterThan(
      calls.indexOf("herdr pane close w3:p9"),
    );
    expect(JSON.parse(h.out())).toMatchObject({
      name: "image-trust-writer",
      paneId: "w3:p9",
      closed: true,
    });
  });

  it("prints the worktree removal commands when the session had a worktree", async () => {
    const worktree = { path: "/main/.claude/worktrees/x", branch: "feat/x" };
    const h = testHarness({
      env: INSIDE,
      files: stateOf({ ...withResult, worktree }),
      responses: [gitCommon, layoutOf()],
    });
    expect(await run(close, h.deps)).toBe(0);
    const out = JSON.parse(h.out()) as { hint: string };
    expect(out.hint).toContain("git worktree remove /main/.claude/worktrees/x");
    expect(out.hint).toContain("git branch -D feat/x");
    const human = testHarness({
      env: INSIDE,
      files: stateOf({ ...withResult, worktree }),
      responses: [gitCommon, layoutOf()],
    });
    await run(["session", "close", "image-trust-writer"], human.deps);
    expect(human.out()).toContain("git worktree remove");
  });

  it("prints no worktree hint for a session without one", async () => {
    const h = testHarness({
      env: INSIDE,
      files: stateOf(withResult),
      responses: [gitCommon, layoutOf()],
    });
    await run(close, h.deps);
    expect(JSON.parse(h.out())).not.toHaveProperty("hint");
  });

  it("refuses a pane this tool did not create, closing nothing", async () => {
    const h = testHarness({ env: INSIDE, responses: [gitCommon] });
    expect(await run(close, h.deps)).toBe(1);
    expect(h.err()).toContain("did not create");
    expect(closes(h)).toEqual([]);
  });
});

describe("session close refusals and recording", () => {
  it("refuses a session whose result is not recorded, naming session wait", async () => {
    const h = testHarness({
      env: INSIDE,
      files: stateOf(created),
      responses: [gitCommon],
    });
    expect(await run(close, h.deps)).toBe(1);
    expect(h.err()).toContain("session wait");
    expect(closes(h)).toEqual([]);
  });

  it("refuses a pane another caller created", async () => {
    const h = testHarness({
      env: { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p77" },
      files: stateOf(withResult),
      responses: [gitCommon],
    });
    expect(await run(close, h.deps)).toBe(1);
    expect(h.err()).toContain("w3:p1");
    expect(closes(h)).toEqual([]);
  });

  it("does not close the same session twice", async () => {
    const h = testHarness({
      env: INSIDE,
      files: stateOf(withResult),
      responses: [gitCommon, layoutOf()],
    });
    await run(close, h.deps);
    expect(await run(close, h.deps)).toBe(1);
    expect(h.err()).toContain("already closed");
    expect(closes(h)).toHaveLength(1);
  });

  it("reports herdr's message when the pane cannot be closed, and keeps the session open", async () => {
    const h = testHarness({
      env: INSIDE,
      files: stateOf(withResult),
      responses: [
        gitCommon,
        {
          match: (_c, a) => a[1] === "close",
          result: { code: 1, stderr: "pane_not_found" },
        },
      ],
    });
    expect(await run(close, h.deps)).toBe(1);
    expect(h.err()).toContain("pane_not_found");
  });

  it("refuses outside Herdr with zero herdr calls", async () => {
    const h = testHarness({
      files: stateOf(withResult),
      responses: [gitCommon],
    });
    expect(await run(close, h.deps)).toBe(1);
    expect(h.err()).toContain("HERDR_ENV");
    expect(herdrCalls(h)).toEqual([]);
  });
});

describe("session close name validation", () => {
  it.each(["Bad Name", "../escape", "a/b"])(
    "rejects the name %j before touching git or the registry",
    async (name) => {
      const h = testHarness({ env: INSIDE, responses: [gitCommon] });
      expect(await run(["session", "close", name], h.deps)).toBe(2);
      expect(h.err()).toContain("Session name");
      expect(h.runner.calls).toEqual([]);
    },
  );
});
