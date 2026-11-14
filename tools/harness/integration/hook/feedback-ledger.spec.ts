// Feedback hook: ledger recording and fail-open behaviour.

import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/index.js";
import { testHarness } from "../../src/testing/index.js";
import * as hookFeedback from "./hook-feedback-support.js";

const { KORE_BIN, edited, failing, hook, ledgerEvents, root } = hookFeedback;

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

describe("hook feedback records token usage at stop", () => {
  const TRANSCRIPT = "/home/t/session.jsonl";
  const turn = (id: string, input: number, output: number, cached = 0) =>
    JSON.stringify({
      type: "assistant",
      message: {
        id,
        content: [{ type: "text", text: "private words" }],
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_creation_input_tokens: cached,
          cache_read_input_tokens: 99_999,
        },
      },
    });

  async function stopWith(lines: string[], extra: object = {}) {
    const h = testHarness({
      env: { CLAUDE_PROJECT_DIR: root, KORE_ROOT: root },
    });
    h.files.set(TRANSCRIPT, lines.join("\n"));
    h.deps.stdin = () =>
      Promise.resolve(
        JSON.stringify({
          session_id: "s1",
          transcript_path: TRANSCRIPT,
          ...extra,
        }),
      );
    await run(["hook", "feedback", "stop"], h.deps);
    return ledgerEvents(h.files);
  }

  it("records the session's tokens so far, counting each message once and leaving cache reads out", async () => {
    const events = await stopWith([
      turn("m1", 10, 5),
      turn("m1", 10, 20),
      turn("m2", 100, 30, 40),
      "not json",
    ]);
    expect(events).toMatchObject([
      { kind: "session.stop" },
      { kind: "token.usage", session: "s1", source: "claude", tokens: 200 },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/private words/);
  });

  it("records no usage for an empty, unreadable or missing transcript", async () => {
    expect((await stopWith([])).map((e) => e["kind"])).toEqual([
      "session.stop",
    ]);
    const missing = await hook("stop", {
      session_id: "s1",
      transcript_path: "/nowhere.jsonl",
    });
    expect(missing.events.map((e) => e["kind"])).toEqual(["session.stop"]);
    expect(missing.code).toBe(0);
  });

  it("records nothing on a stop re-entry", async () => {
    expect(
      await stopWith([turn("m1", 1, 1)], { stop_hook_active: true }),
    ).toEqual([]);
  });
});

const TRANSCRIPT = "/home/t/inc.jsonl";
const turn = (id: string, input: number, output: number) =>
  `${JSON.stringify({
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text: "private words" }],
      usage: { input_tokens: input, output_tokens: output },
    },
  })}\n`;

/** One session whose transcript grows between stops; counts what each stop reads. */
function session() {
  const h = testHarness({
    env: { CLAUDE_PROJECT_DIR: root, KORE_ROOT: root },
  });
  const reads: { offset: number; bytes: number }[] = [];
  const fs = h.deps.fs;
  const readFrom = fs.readFrom.bind(fs);
  fs.readFrom = async (path, offset) => {
    const text = await readFrom(path, offset);
    if (path === TRANSCRIPT) {
      reads.push({ offset, bytes: Buffer.byteLength(text) });
    }
    return text;
  };
  const readFile = fs.readFile.bind(fs);
  fs.readFile = (path) => {
    if (path === TRANSCRIPT) {
      throw new Error("the whole transcript must not be read");
    }
    return readFile(path);
  };
  h.deps.stdin = () =>
    Promise.resolve(
      JSON.stringify({ session_id: "s1", transcript_path: TRANSCRIPT }),
    );
  return {
    reads,
    append: (text: string) =>
      h.files.set(TRANSCRIPT, (h.files.get(TRANSCRIPT) ?? "") + text),
    async stop() {
      await run(["hook", "feedback", "stop"], h.deps);
      return ledgerEvents(h.files).filter((e) => e["kind"] === "token.usage");
    },
  };
}

describe("hook feedback reads the transcript incrementally", () => {
  it("reads only the bytes added since the last stop and keeps the running total", async () => {
    const s = session();
    const first = turn("m1", 100, 50);
    s.append(first);
    expect((await s.stop()).map((e) => e["tokens"])).toEqual([150]);
    const next = turn("m2", 20, 5) + turn("m3", 1, 1);
    s.append(next);
    expect((await s.stop()).map((e) => e["tokens"])).toEqual([150, 177]);
    expect(s.reads).toEqual([
      { offset: 0, bytes: Buffer.byteLength(first) },
      { offset: Buffer.byteLength(first), bytes: Buffer.byteLength(next) },
    ]);
  });

  it("costs the same on a huge transcript as on a small one: a stop with nothing new reads nothing and records nothing", async () => {
    const s = session();
    s.append(
      Array.from({ length: 5000 }, (_, i) => turn(`m${i}`, 1, 1)).join(""),
    );
    expect(await s.stop()).toHaveLength(1);
    const again = await s.stop();
    expect(again).toHaveLength(1);
    expect(s.reads.at(-1)?.bytes).toBe(0);
  });

  it("leaves a half-written last line for the next stop", async () => {
    const s = session();
    const whole = turn("m2", 10, 10);
    s.append(turn("m1", 1, 1) + whole.slice(0, 30));
    expect((await s.stop()).map((e) => e["tokens"])).toEqual([2]);
    s.append(whole.slice(30));
    expect((await s.stop()).map((e) => e["tokens"])).toEqual([2, 22]);
  });

  it("counts a message once when its later copy arrives after a stop", async () => {
    const s = session();
    s.append(turn("m1", 10, 5));
    await s.stop();
    s.append(turn("m1", 10, 40));
    expect((await s.stop()).map((e) => e["tokens"])).toEqual([15, 50]);
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
