// The compaction counter (#1037, spec #1027): from a session start with the compact matcher,
// one session.compacted reading per compaction, numbered by the compact summaries the
// transcript holds so a replay of the same record carries the same id. The ledger writer is
// mocked; the transcript is a typed fake file system.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { compactionsIn, recordCompaction } from "./compaction.js";
import { recordEvent } from "./ledger-event.js";

vi.mock("./ledger-event.js");

const TRANSCRIPT = "/home/jun/.claude/projects/kore/abc.jsonl";
const readFile = vi.fn();
const DEPS = { tag: "deps", fs: { readFile } } as unknown as CliDeps;

const line = (event: object) => JSON.stringify(event);
const SUMMARY = line({
  type: "user",
  isCompactSummary: true,
  message: { content: "a long summary of the earlier conversation" },
});
const PROMPT = line({ type: "user", message: { content: "hello" } });

beforeEach(() => {
  readFile.mockReset();
});

describe("compactionsIn counts the compactions a transcript holds", () => {
  it("counts each compact summary line once", () => {
    expect(
      compactionsIn([PROMPT, SUMMARY, PROMPT, SUMMARY, PROMPT].join("\n")),
    ).toBe(2);
  });

  it("counts none for a transcript with no compact summary", () => {
    expect(compactionsIn([PROMPT, PROMPT].join("\n"))).toBe(0);
  });

  it("skips a torn or foreign line instead of failing the count", () => {
    expect(compactionsIn([PROMPT, "{not json", SUMMARY, ""].join("\n"))).toBe(
      1,
    );
  });

  it("does not count a summary mentioned inside a message's text", () => {
    const quoted = line({
      type: "user",
      message: { content: 'the flag "isCompactSummary": true' },
    });

    expect(compactionsIn(quoted)).toBe(0);
  });
});

describe("recordCompaction records one reading per compaction", () => {
  it("records session.compacted with the compaction's number and an id that names session and number", async () => {
    readFile.mockResolvedValue([PROMPT, SUMMARY, PROMPT, SUMMARY].join("\n"));
    const call = { session_id: "abc", transcript_path: TRANSCRIPT };

    await recordCompaction(DEPS, call);

    expect(readFile).toHaveBeenCalledWith(TRANSCRIPT);
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith(
      DEPS,
      "session.compacted",
      call,
      undefined,
      { id: "compaction:abc:2", compaction: 2 },
    );
  });

  it("gives a replay of the same record the same id, which the ledger writer records once", async () => {
    readFile.mockResolvedValue([PROMPT, SUMMARY].join("\n"));
    const call = { session_id: "abc", transcript_path: TRANSCRIPT };

    await recordCompaction(DEPS, call);
    await recordCompaction(DEPS, call);

    const ids = vi.mocked(recordEvent).mock.calls.map((c) => c[4]?.id);
    expect(ids).toEqual(["compaction:abc:1", "compaction:abc:1"]);
  });

  it("gives the next compaction the next number, so it is a new reading", async () => {
    const call = { session_id: "abc", transcript_path: TRANSCRIPT };
    readFile.mockResolvedValueOnce(SUMMARY);
    readFile.mockResolvedValueOnce([SUMMARY, PROMPT, SUMMARY].join("\n"));

    await recordCompaction(DEPS, call);
    await recordCompaction(DEPS, call);

    const ids = vi.mocked(recordEvent).mock.calls.map((c) => c[4]?.id);
    expect(ids).toEqual(["compaction:abc:1", "compaction:abc:2"]);
  });

  it("records nothing when the transcript holds no compact summary yet, rather than a number it cannot name", async () => {
    readFile.mockResolvedValue(PROMPT);

    await recordCompaction(DEPS, {
      session_id: "abc",
      transcript_path: TRANSCRIPT,
    });

    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("records nothing when the transcript cannot be read", async () => {
    readFile.mockRejectedValue(new Error("ENOENT"));

    await recordCompaction(DEPS, {
      session_id: "abc",
      transcript_path: TRANSCRIPT,
    });

    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("records nothing and reads nothing without a transcript path or a session", async () => {
    await recordCompaction(DEPS, { session_id: "abc" });
    await recordCompaction(DEPS, { transcript_path: TRANSCRIPT });

    expect(readFile).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });
});
