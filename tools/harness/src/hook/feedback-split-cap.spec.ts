// The stop hook's largest prompt and over-cap count on the priced token split (#1032): the
// pure advance over transcript text with a compaction cap, the cap's boundary, a streamed
// repeat, and the reads that carry the cap. The file system, the path helpers, the prompt
// step and the name check are mocks, as in feedback-split.spec.ts (ADR 0098).

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

const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";
/** The compaction cap the tests set, a small number so each prompt is easy to read. */
const CAP = 100;

/** One assistant transcript line with the given message id, model and raw usage object. */
const request = (id: string, model: string, usage: object) =>
  JSON.stringify({ type: "assistant", message: { id, model, usage } });

/** A usage object whose prompt is input plus cache reads and writes. */
const usage = (input: number, output = 1, read = 0, w5 = 0, w1 = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation: {
    ephemeral_5m_input_tokens: w5,
    ephemeral_1h_input_tokens: w1,
  },
});

describe("feedback split advance: largest prompt", () => {
  it("reports each model's largest prompt, with input, cache writes and reads together", () => {
    const text = [
      request("m1", HAIKU, usage(10)),
      request("m2", HAIKU, usage(40, 1, 50, 5, 5)),
      request("m3", HAIKU, usage(3)),
      "",
    ].join("\n");
    const [reading] = readingsOf(advanceSplit(EMPTY_SPLIT, text, CAP), CAP);
    expect(reading).toMatchObject({ firstPrompt: 10, largestPrompt: 100 });
  });

  it("keeps the largest prompt across stops, when a later stop reads more requests", () => {
    const first = advanceSplit(
      EMPTY_SPLIT,
      `${request("m1", HAIKU, usage(150))}\n`,
      CAP,
    );
    const second = advanceSplit(
      first,
      `${request("m2", HAIKU, usage(20))}\n`,
      CAP,
    );
    expect(readingsOf(second, CAP)[0]).toMatchObject({
      largestPrompt: 150,
      overCap: 1,
    });
  });

  it("reads no reading, so no largest prompt, for a transcript with no requests", () => {
    expect(readingsOf(advanceSplit(EMPTY_SPLIT, "", CAP), CAP)).toEqual([]);
  });
});

describe("feedback split advance: over the compaction cap", () => {
  it("counts a request exactly at the cap as not over it, and one token more as over", () => {
    const atCap = advanceSplit(
      EMPTY_SPLIT,
      `${request("m1", HAIKU, usage(CAP))}\n`,
      CAP,
    );
    expect(readingsOf(atCap, CAP)[0]).toMatchObject({
      largestPrompt: CAP,
      overCap: 0,
    });
    const oneOver = advanceSplit(
      EMPTY_SPLIT,
      `${request("m1", HAIKU, usage(CAP + 1))}\n`,
      CAP,
    );
    expect(readingsOf(oneOver, CAP)[0]).toMatchObject({
      largestPrompt: CAP + 1,
      overCap: 1,
    });
  });

  it("counts the requests over the cap of each model apart", () => {
    const text = [
      request("m1", HAIKU, usage(150)),
      request("m2", HAIKU, usage(160)),
      request("m3", SONNET, usage(90)),
      request("m4", SONNET, usage(200)),
      "",
    ].join("\n");
    const [haiku, sonnet] = readingsOf(
      advanceSplit(EMPTY_SPLIT, text, CAP),
      CAP,
    );
    expect(haiku).toMatchObject({ largestPrompt: 160, overCap: 2 });
    expect(sonnet).toMatchObject({ largestPrompt: 200, overCap: 1 });
  });
});

describe("feedback split advance: repeats and a cap set late", () => {
  it("replaces a streamed repeat's count rather than adding it again, and can lower the largest prompt", () => {
    const text = [
      request("a", HAIKU, usage(90)),
      request("b", HAIKU, usage(150)),
      request("b", HAIKU, usage(80)),
      "",
    ].join("\n");
    const [reading] = readingsOf(advanceSplit(EMPTY_SPLIT, text, CAP), CAP);
    expect(reading).toMatchObject({
      lowRequests: 2,
      largestPrompt: 90,
      overCap: 0,
    });
  });

  it("replaces a repeat that streams in at a later stop with its earlier count", () => {
    const first = advanceSplit(
      EMPTY_SPLIT,
      `${request("m1", HAIKU, usage(150))}\n`,
      CAP,
    );
    const second = advanceSplit(
      first,
      `${request("m1", HAIKU, usage(120))}\n`,
      CAP,
    );
    expect(readingsOf(second, CAP)[0]).toMatchObject({
      lowRequests: 1,
      largestPrompt: 120,
      overCap: 1,
    });
  });
});

describe("feedback split advance: no cap, and a cap set late", () => {
  it("leaves the over-cap count out when no cap is set, rather than reporting zero", () => {
    const [reading] = readingsOf(
      advanceSplit(EMPTY_SPLIT, `${request("m1", HAIKU, usage(500))}\n`),
    );
    expect(reading).toMatchObject({ largestPrompt: 500 });
    expect(reading).not.toHaveProperty("overCap");
  });

  it("counts only the requests read while a cap is set", () => {
    const uncapped = advanceSplit(
      EMPTY_SPLIT,
      `${request("m1", HAIKU, usage(150))}\n`,
    );
    const capped = advanceSplit(
      uncapped,
      `${request("m2", HAIKU, usage(170))}\n`,
      CAP,
    );
    expect(readingsOf(capped, CAP)[0]).toMatchObject({
      largestPrompt: 170,
      overCap: 1,
    });
  });

  it("keeps the largest prompt and over-cap count to numbers and the model name", () => {
    const text = `${JSON.stringify({
      type: "assistant",
      message: {
        id: "m1",
        model: HAIKU,
        content: [{ type: "text", text: "secret prompt words" }],
        usage: usage(150),
      },
    })}\n`;
    const reading = readingsOf(advanceSplit(EMPTY_SPLIT, text, CAP), CAP);
    expect(reading[0]).toMatchObject({
      model: HAIKU,
      largestPrompt: 150,
      overCap: 1,
    });
    expect(JSON.stringify(reading)).not.toContain("secret");
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
const saved: SplitState = { offset: 0, models: [] };

describe("feedback split reads: the compaction cap", () => {
  it("returns the over-cap count and largest prompt of the stop's requests when a cap is passed", async () => {
    const fs = fakeFs();
    fs.readFile.mockResolvedValue(JSON.stringify(saved));
    fs.readFrom.mockResolvedValue(`${request("m1", HAIKU, usage(150))}\n`);
    expect(await readSplit(port(fs), "/t.jsonl", state, CAP)).toEqual([
      expect.objectContaining({
        model: HAIKU,
        largestPrompt: 150,
        overCap: 1,
      }),
    ]);
  });

  it("starts from the top, and counts each request once, when the saved state predates the largest prompt", async () => {
    const fs = fakeFs();
    const zero = {
      requests: 0,
      input: 0,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      output: 0,
    };
    const predating = {
      offset: 50,
      models: [
        {
          model: HAIKU,
          firstPrompt: 10,
          low: { ...zero, requests: 1, input: 10, output: 1 },
          high: zero,
        },
      ],
    };
    fs.readFile.mockResolvedValue(JSON.stringify(predating));
    fs.readFrom.mockResolvedValue(`${request("m1", HAIKU, usage(10))}\n`);
    const readings = await readSplit(port(fs), "/t.jsonl", state, CAP);
    expect(fs.readFrom.mock.calls).toEqual([["/t.jsonl", 0]]);
    expect(readings).toEqual([
      expect.objectContaining({
        model: HAIKU,
        lowRequests: 1,
        lowInput: 10,
        largestPrompt: 10,
        overCap: 0,
      }),
    ]);
  });
});
