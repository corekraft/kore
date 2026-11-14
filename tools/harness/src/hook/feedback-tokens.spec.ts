// Token counting for the stop hook: what a transcript's usage lines add up to,
// and how a stop reads only what the last stop had not counted. The file system
// is a typed mock; the temporary directory and path helpers are mocks too.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import {
  advance,
  EMPTY,
  readTokens,
  tokenStateFile,
  type TokenState,
} from "./feedback-tokens.js";

vi.mock("node:os");
vi.mock("node:path");

/** One assistant transcript line with the given message id and usage counts. */
const usage = (
  id: string,
  input: number,
  output: number,
  cache = 0,
  read = 0,
) =>
  JSON.stringify({
    type: "assistant",
    message: {
      id,
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_creation_input_tokens: cache,
        cache_read_input_tokens: read,
      },
    },
  });

beforeEach(() => {
  vi.mocked(tmpdir).mockReturnValue("/tmp");
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
});

describe("feedback token state file", () => {
  it("names the file after the session, keeping only word characters, dots and dashes", () => {
    expect(tokenStateFile("abc-1.2_x")).toBe("/tmp/kore-tokens-abc-1.2_x.json");
    expect(tokenStateFile("a/b c")).toBe("/tmp/kore-tokens-a_b_c.json");
  });

  it("uses one default file when the session id is missing or not text", () => {
    expect(tokenStateFile(undefined)).toBe("/tmp/kore-tokens-default.json");
    expect(tokenStateFile(42)).toBe("/tmp/kore-tokens-default.json");
  });
});

describe("feedback token advance", () => {
  it("adds input, output and cache-creation tokens, never cache reads", () => {
    const state = advance(EMPTY, `${usage("m1", 10, 5, 3, 999)}\n`);
    expect(state.total).toBe(18);
  });

  it("ignores lines that are not assistant usage, and lines that are not JSON", () => {
    const text = [
      '{"type":"user","message":{"usage":{"input_tokens":50}}}',
      "not json",
      usage("m1", 4, 0),
      "",
    ].join("\n");
    expect(advance(EMPTY, text).total).toBe(4);
  });

  it("replaces a message's earlier count when its later copy arrives, rather than adding to it", () => {
    const text = `${usage("m1", 10, 0)}\n${usage("m1", 10, 15)}\n`;
    expect(advance(EMPTY, text).total).toBe(25);
  });

  it("treats a count that is not a positive finite number as zero", () => {
    const text = `${JSON.stringify({
      type: "assistant",
      message: { id: "m1", usage: { input_tokens: -5, output_tokens: "7" } },
    })}\n`;
    expect(advance(EMPTY, text).total).toBe(0);
  });

  it("leaves a half-written last line for the next stop", () => {
    const complete = `${usage("m1", 10, 0)}\n`;
    const state = advance(EMPTY, `${complete}${usage("m2", 99, 0)}`);
    expect(state.total).toBe(10);
    expect(state.offset).toBe(Buffer.byteLength(complete));
  });

  it("moves the offset by bytes, so multi-byte text counts once", () => {
    const text = '{"type":"user","note":"é"}\n';
    expect(advance(EMPTY, text).offset).toBe(Buffer.byteLength(text));
  });

  it("keeps the last message id and count so a later copy can replace them", () => {
    const state = advance(EMPTY, `${usage("m9", 6, 2)}\n`);
    expect(state).toEqual({
      offset: expect.any(Number),
      total: 8,
      lastId: "m9",
      lastTokens: 8,
    });
  });
});

const state = "/tmp/kore-tokens-s1.json";
const saved: TokenState = { offset: 4, total: 10 };

/** A typed file system whose state file and transcript reads are mocks. */
function fakeFs() {
  return {
    readFile: vi.fn<FileSystem["readFile"]>(),
    writeFile: vi.fn<FileSystem["writeFile"]>(() => Promise.resolve()),
    readFrom: vi.fn<FileSystem["readFrom"]>(),
  };
}

describe("feedback token reads, what is counted", () => {
  it("reads nothing and reports no growth when there is no transcript path", async () => {
    const fs = fakeFs();
    expect(await readTokens(fs as never, undefined, state)).toEqual({
      total: 0,
      grew: false,
    });
    expect(await readTokens(fs as never, "", state)).toEqual({
      total: 0,
      grew: false,
    });
    expect(fs.readFrom).not.toHaveBeenCalled();
  });

  it("reads the transcript from the saved offset, and saves the new state", async () => {
    const fs = fakeFs();
    fs.readFile.mockResolvedValue(JSON.stringify(saved));
    fs.readFrom.mockResolvedValue(`${usage("m1", 5, 0)}\n`);
    expect(await readTokens(fs as never, "/t.jsonl", state)).toEqual({
      total: 15,
      grew: true,
    });
    expect(fs.readFrom.mock.calls).toEqual([["/t.jsonl", 4]]);
    expect(fs.writeFile.mock.calls).toEqual([
      [
        state,
        JSON.stringify({
          offset: 4 + Buffer.byteLength(`${usage("m1", 5, 0)}\n`),
          total: 15,
          lastId: "m1",
          lastTokens: 5,
        }),
      ],
    ]);
  });
});

describe("feedback token reads, damaged and unreadable input", () => {
  it("starts from the top when the state file is missing or damaged", async () => {
    const fs = fakeFs();
    fs.readFile.mockRejectedValueOnce(new Error("ENOENT"));
    fs.readFrom.mockResolvedValueOnce("");
    expect(await readTokens(fs as never, "/t.jsonl", state)).toEqual({
      total: 0,
      grew: false,
    });
    fs.readFile.mockResolvedValueOnce("{");
    fs.readFrom.mockResolvedValueOnce("");
    expect(await readTokens(fs as never, "/t.jsonl", state)).toEqual({
      total: 0,
      grew: false,
    });
    expect(fs.readFrom.mock.calls).toEqual([
      ["/t.jsonl", 0],
      ["/t.jsonl", 0],
    ]);
  });

  it("treats a state with a negative offset as damaged", async () => {
    const fs = fakeFs();
    fs.readFile.mockResolvedValue(JSON.stringify({ offset: -1, total: 9 }));
    fs.readFrom.mockResolvedValue("");
    await readTokens(fs as never, "/t.jsonl", state);
    expect(fs.readFrom.mock.calls).toEqual([["/t.jsonl", 0]]);
  });

  it("does not rewrite the state when nothing new was read", async () => {
    const fs = fakeFs();
    fs.readFile.mockResolvedValue(JSON.stringify(saved));
    fs.readFrom.mockResolvedValue("");
    expect(await readTokens(fs as never, "/t.jsonl", state)).toEqual({
      total: 10,
      grew: false,
    });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("reports no growth for an unreadable transcript, rather than failing the stop", async () => {
    const fs = fakeFs();
    fs.readFile.mockResolvedValue(JSON.stringify(saved));
    fs.readFrom.mockRejectedValue(new Error("EIO"));
    expect(await readTokens(fs as never, "/t.jsonl", state)).toEqual({
      total: 0,
      grew: false,
    });
  });
});
