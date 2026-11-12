// Feedback hook: ledger recording and fail-open behaviour.

import { describe, expect, it } from "vitest";
import { run } from "../cli/index.js";
import { testHarness } from "../cli/cli-support.js";
import {
  KORE_BIN,
  edited,
  failing,
  hook,
  ledgerEvents,
  root,
} from "./feedback-support.js";

describe("hook feedback records ledger events", () => {
  it("records a tool end as success after any tool, with session, pane and tool", async () => {
    const h = testHarness({
      env: {
        KORE_ROOT: root,
        CLAUDE_PROJECT_DIR: root,
        HERDR_PANE_ID: "w9:p9",
      },
    });
    h.deps.stdin = () =>
      Promise.resolve(
        JSON.stringify({
          session_id: "s1",
          tool_name: "Bash",
          tool_input: { command: "echo secret" },
        }),
      );
    expect(await run(["hook", "feedback", "post-edit"], h.deps)).toBe(0);
    const [event] = ledgerEvents(h.files);
    expect(event).toMatchObject({
      source: "claude",
      kind: "tool.end",
      session: "s1",
      pane: "w9:p9",
      tool: "Bash",
      outcome: "success",
    });
    expect(JSON.stringify(event)).not.toMatch(/secret/);
  });

  it("records a failed tool as a failure and never fails the hook", async () => {
    const result = await hook("tool-failure", {
      session_id: "s1",
      tool_name: "Bash",
    });
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.calls).toEqual([]);
    expect(result.events).toMatchObject([
      { kind: "tool.end", outcome: "failure" },
    ]);
  });

  it("records a session stop once, not on its own re-entry", async () => {
    const first = await hook("stop", { session_id: "s1" });
    expect(first.events).toMatchObject([{ kind: "session.stop" }]);
    const again = await hook("stop", {
      session_id: "s1",
      stop_hook_active: true,
    });
    expect(again.events).toEqual([]);
  });

  it("still returns the edit failure when recording works", async () => {
    const result = await hook(
      "post-edit",
      edited("/repo/tools/kore/src/a.ts"),
      {
        responses: [failing(`${KORE_BIN}/oxlint`, "bad")],
      },
    );
    expect(result.code).toBe(2);
    expect(result.events).toMatchObject([
      { kind: "tool.end", outcome: "success" },
    ]);
  });
});

describe("hook feedback ledger recording is best effort", () => {
  it("records nothing without a session id", async () => {
    const result = await hook("post-edit", { tool_name: "Bash" });
    expect(result.events).toEqual([]);
  });

  it("leaves the verdict unchanged when no ledger root can be found", async () => {
    const h = testHarness({ env: { CLAUDE_PROJECT_DIR: root } });
    h.deps.root = () => Promise.reject(new Error("no root"));
    h.deps.stdin = () =>
      Promise.resolve(JSON.stringify(edited("/repo/README.md")));
    expect(await run(["hook", "feedback", "post-edit"], h.deps)).toBe(0);
    expect(h.err()).toBe("");
    expect(h.files.size).toBe(0);
  });

  it("leaves the verdict unchanged when the ledger cannot be written", async () => {
    const h = testHarness({
      env: { CLAUDE_PROJECT_DIR: root, KORE_ROOT: root },
    });
    h.deps.fs.appendFile = () => Promise.reject(new Error("disk full"));
    h.deps.stdin = () =>
      Promise.resolve(JSON.stringify(edited("/repo/README.md")));
    expect(await run(["hook", "feedback", "post-edit"], h.deps)).toBe(0);
    expect(h.err()).toBe("");
  });
});

describe("hook feedback fails open", () => {
  it("exits 0 and says nothing for empty or malformed stdin", async () => {
    for (const stdin of ["", "not json"]) {
      const h = testHarness();
      h.deps.stdin = () => Promise.resolve(stdin);
      expect(await run(["hook", "feedback", "post-edit"], h.deps)).toBe(0);
      expect(h.err()).toBe("");
    }
  });

  it("names the hook and the modes for an unknown mode, without blocking", async () => {
    const h = testHarness();
    h.deps.stdin = () => Promise.resolve("{}");
    expect(await run(["hook", "feedback", "bogus"], h.deps)).toBe(0);
    expect(h.err()).toBe(
      '[hook:feedback] failed open: Unknown feedback mode "bogus". Modes: post-edit, stop, tool-failure.\n',
    );
    const bare = testHarness();
    expect(await run(["hook", "feedback"], bare.deps)).toBe(0);
    expect(bare.err()).toMatch(/Unknown feedback mode ""/);
  });
});
