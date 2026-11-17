// The stop hook's priced token split: what a transcript's usage lines add up to per model
// and prompt step, and how a stop reads only what the last stop had not counted. The file
// system is a typed mock; the temporary directory, path helpers, the prompt step and the
// name check are mocks too, since they belong to other units (ADR 0098).

import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import { promptStepOf } from "../flow/index.js";
import { isName } from "../ledger/index.js";
import {
  advanceSplit,
  EMPTY_SPLIT,
  readingsOf,
  readSplit,
  splitStateFile,
  type SplitState,
} from "./feedback-split.js";

vi.mock("node:os", () => ({ tmpdir: vi.fn() }));
vi.mock("node:path", () => ({ join: vi.fn() }));
vi.mock("../flow/index.js", () => ({ promptStepOf: vi.fn() }));
vi.mock("../ledger/index.js", () => ({ isName: vi.fn() }));

beforeEach(() => {
  vi.mocked(tmpdir).mockReturnValue("/tmp");
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(promptStepOf).mockImplementation((prompt) =>
    prompt > 100_000 ? "high" : "low",
  );
  vi.mocked(isName).mockImplementation((value) => value !== "<synthetic>");
});

/** One assistant transcript line with the given message id, model and raw usage object. */
const request = (id: string, model: string, usage: object) =>
  JSON.stringify({ type: "assistant", message: { id, model, usage } });

/** A usage object with a 5 minute and a 1 hour cache write, as the transcript records them. */
const usage = (input: number, output: number, read = 0, w5 = 0, w1 = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation: {
    ephemeral_5m_input_tokens: w5,
    ephemeral_1h_input_tokens: w1,
  },
});

const HAIKU = "claude-haiku-5-5";

describe("feedback split state file", () => {
  it("names the file after the session, keeping only word characters, dots and dashes", () => {
    expect(splitStateFile("abc-1.2_x")).toBe("/tmp/kore-split-abc-1.2_x.json");
    expect(splitStateFile("a/b c")).toBe("/tmp/kore-split-a_b_c.json");
    expect(splitStateFile(undefined)).toBe("/tmp/kore-split-default.json");
  });
});

describe("feedback split advance: what is counted", () => {
  it("counts each request's tokens in the step its prompt falls in, cache reads included", () => {
    const text = `${request("m1", HAIKU, usage(10, 5, 70, 0, 20))}\n`;
    const [reading] = readingsOf(advanceSplit(EMPTY_SPLIT, text));
    expect(promptStepOf).toHaveBeenCalledWith(100);
    expect(reading).toEqual({
      model: HAIKU,
      firstPrompt: 100,
      lowRequests: 1,
      lowInput: 10,
      lowCacheWrite5m: 0,
      lowCacheWrite1h: 20,
      lowCacheRead: 70,
      lowOutput: 5,
      highRequests: 0,
      highInput: 0,
      highCacheWrite5m: 0,
      highCacheWrite1h: 0,
      highCacheRead: 0,
      highOutput: 0,
    });
  });

  it("puts a request whose prompt passes the step in the high step, on all its tokens", () => {
    const text = `${request("m1", HAIKU, usage(5, 9, 200_000, 3, 4))}\n`;
    const [reading] = readingsOf(advanceSplit(EMPTY_SPLIT, text));
    expect(reading).toMatchObject({
      firstPrompt: 200_012,
      lowRequests: 0,
      highRequests: 1,
      highInput: 5,
      highCacheWrite5m: 3,
      highCacheWrite1h: 4,
      highCacheRead: 200_000,
      highOutput: 9,
    });
  });

  it("counts a cache write without a 5 minute and 1 hour breakdown as a 1 hour write", () => {
    const line = request("m1", HAIKU, {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 40,
    });
    const [reading] = readingsOf(advanceSplit(EMPTY_SPLIT, `${line}\n`));
    expect(reading).toMatchObject({
      firstPrompt: 41,
      lowCacheWrite5m: 0,
      lowCacheWrite1h: 40,
    });
  });
});

describe("feedback split advance: repeats, skips and text", () => {
  it("replaces a streamed repeat of the last message instead of counting it again", () => {
    const text = [
      request("m1", HAIKU, usage(10, 1, 5)),
      request("m1", HAIKU, usage(10, 7, 5)),
      "",
    ].join("\n");
    const [reading] = readingsOf(advanceSplit(EMPTY_SPLIT, text));
    expect(reading).toMatchObject({
      lowRequests: 1,
      lowInput: 10,
      lowCacheRead: 5,
      lowOutput: 7,
    });
  });

  it("keeps each model's totals and first prompt apart", () => {
    const text = [
      request("m1", HAIKU, usage(10, 1)),
      request("m2", "claude-sonnet-5-5", usage(300, 2)),
      request("m3", HAIKU, usage(20, 3)),
      "",
    ].join("\n");
    const [haiku, sonnet] = readingsOf(advanceSplit(EMPTY_SPLIT, text));
    expect(haiku).toMatchObject({
      model: HAIKU,
      firstPrompt: 10,
      lowRequests: 2,
      lowInput: 30,
    });
    expect(sonnet).toMatchObject({
      model: "claude-sonnet-5-5",
      firstPrompt: 300,
      lowRequests: 1,
      lowInput: 300,
    });
  });

  it("skips lines that are not assistant usage, lines that are not JSON, and models that are not names", () => {
    const text = [
      '{"type":"user","message":{"usage":{"input_tokens":50}}}',
      "not json",
      request("m1", "<synthetic>", usage(9, 9)),
      request("m2", HAIKU, usage(4, 0)),
      "",
    ].join("\n");
    expect(readingsOf(advanceSplit(EMPTY_SPLIT, text))).toEqual([
      expect.objectContaining({ model: HAIKU, lowRequests: 1, lowInput: 4 }),
    ]);
  });
});

describe("feedback split advance: partial lines and text", () => {
  it("counts complete lines only, so a half-written last line waits for the next stop", () => {
    const complete = `${request("m1", HAIKU, usage(10, 1))}\n`;
    const state = advanceSplit(
      EMPTY_SPLIT,
      `${complete}${request("m2", HAIKU, usage(99, 0))}`,
    );
    expect(readingsOf(state)[0]).toMatchObject({
      lowRequests: 1,
      lowInput: 10,
    });
    expect(state.offset).toBe(Buffer.byteLength(complete));
  });

  it("keeps numbers and the model name only, so no transcript text reaches the state", () => {
    const text = `${JSON.stringify({
      type: "assistant",
      message: {
        id: "m1",
        model: HAIKU,
        content: [{ type: "text", text: "secret prompt words" }],
        usage: usage(10, 1),
      },
    })}\n`;
    const state = advanceSplit(EMPTY_SPLIT, text);
    expect(JSON.stringify(state)).not.toContain("secret prompt words");
    expect(JSON.stringify(readingsOf(state))).not.toContain("secret");
  });
});

/** A typed file system whose state file and transcript reads are mocks. */
function fakeFs() {
  return {
    readFile: vi.fn<FileSystem["readFile"]>(),
    writeFile: vi.fn<FileSystem["writeFile"]>(() => Promise.resolve()),
    readFrom: vi.fn<FileSystem["readFrom"]>(),
  };
}

/** The fake as the file system the hook reads through. Only the three methods the hook uses are mocked. */
function port(fake: ReturnType<typeof fakeFs>): FileSystem {
  const used: Pick<FileSystem, "readFile" | "writeFile" | "readFrom"> = fake;
  return used as FileSystem;
}

const state = "/tmp/kore-split-s1.json";
const saved: SplitState = {
  offset: 0,
  models: [],
};

describe("feedback split reads: what is appended", () => {
  it("returns the reading of each model whose count grew, and saves the new state", async () => {
    const fs = fakeFs();
    fs.readFile.mockResolvedValue(JSON.stringify(saved));
    const chunk = `${request("m1", HAIKU, usage(10, 1))}\n`;
    fs.readFrom.mockResolvedValue(chunk);
    const readings = await readSplit(port(fs), "/t.jsonl", state);
    expect(readings).toEqual([
      expect.objectContaining({ model: HAIKU, lowRequests: 1, lowInput: 10 }),
    ]);
    expect(fs.readFrom.mock.calls).toEqual([["/t.jsonl", 0]]);
    expect(fs.writeFile).toHaveBeenCalledWith(
      state,
      expect.stringContaining('"offset"'),
    );
  });

  it("returns nothing and does not rewrite the state when no count grew since the last stop", async () => {
    const fs = fakeFs();
    const before = advanceSplit(
      EMPTY_SPLIT,
      `${request("m1", HAIKU, usage(10, 1))}\n`,
    );
    fs.readFile.mockResolvedValue(JSON.stringify(before));
    fs.readFrom.mockResolvedValue("");
    expect(await readSplit(port(fs), "/t.jsonl", state)).toEqual([]);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("returns only the models whose counts grew, each cumulative", async () => {
    const fs = fakeFs();
    const before = advanceSplit(
      EMPTY_SPLIT,
      `${request("m1", HAIKU, usage(10, 1))}\n${request("m2", "claude-sonnet-5-5", usage(4, 4))}\n`,
    );
    fs.readFile.mockResolvedValue(JSON.stringify(before));
    fs.readFrom.mockResolvedValue(`${request("m3", HAIKU, usage(6, 2))}\n`);
    expect(await readSplit(port(fs), "/t.jsonl", state)).toEqual([
      expect.objectContaining({ model: HAIKU, lowRequests: 2, lowInput: 16 }),
    ]);
  });

  it("starts from the top of the transcript when the state file is missing", async () => {
    const fs = fakeFs();
    fs.readFile.mockRejectedValue(new Error("ENOENT"));
    fs.readFrom.mockResolvedValue("");
    expect(await readSplit(port(fs), "/t.jsonl", state)).toEqual([]);
    expect(fs.readFrom.mock.calls).toEqual([["/t.jsonl", 0]]);
  });
});

describe("feedback split reads: what is left out", () => {
  it("reads nothing when there is no transcript path", async () => {
    const fs = fakeFs();
    expect(await readSplit(port(fs), undefined, state)).toEqual([]);
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("reports nothing for an unreadable transcript, rather than failing the stop", async () => {
    const fs = fakeFs();
    fs.readFile.mockResolvedValue(JSON.stringify(saved));
    fs.readFrom.mockRejectedValue(new Error("EIO"));
    expect(await readSplit(port(fs), "/t.jsonl", state)).toEqual([]);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
