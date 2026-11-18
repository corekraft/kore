// The latest prompt size of one session against the compaction cap (#1038): the pure report
// over transcript text, its one text line, and its JSON form. The split reader is a mock
// (ADR 0098); the report only decides over and not over, and never reads the text itself.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { advanceSplit } from "./feedback-split.js";
import { promptLineOf, promptJsonOf, promptSizeOf } from "./prompt-size.js";

vi.mock("./feedback-split.js", () => ({
  advanceSplit: vi.fn(),
  EMPTY_SPLIT: { offset: 0, models: [] },
}));

const SESSION = "112bd8fe-1f2e-4a3b-9c8d-000000000001";
const TRANSCRIPT = "the transcript text";

/** The split reader's answer for a transcript whose latest request has this prompt. */
function latestPrompt(prompt: number) {
  vi.mocked(advanceSplit).mockReturnValue({
    offset: 0,
    models: [],
    last: { model: "claude-opus-5-5", prompt, usage: {} as never },
    lastOver: false,
  });
}

beforeEach(() => {
  vi.mocked(advanceSplit).mockReset();
});

describe("promptSizeOf", () => {
  it("reads the transcript through the split reader with the cap, and reports the latest prompt", () => {
    latestPrompt(183_204);

    const size = promptSizeOf(SESSION, TRANSCRIPT, 80_000);

    expect(advanceSplit).toHaveBeenCalledExactlyOnceWith(
      { offset: 0, models: [] },
      TRANSCRIPT,
      80_000,
    );
    expect(size).toEqual({
      session: SESSION,
      prompt: 183_204,
      cap: 80_000,
      over: true,
    });
  });

  it("reports a prompt exactly at the cap as not over", () => {
    latestPrompt(80_000);

    expect(promptSizeOf(SESSION, TRANSCRIPT, 80_000)).toEqual({
      session: SESSION,
      prompt: 80_000,
      cap: 80_000,
      over: false,
    });
  });

  it("reports one token more than the cap as over", () => {
    latestPrompt(80_001);

    expect(promptSizeOf(SESSION, TRANSCRIPT, 80_000)?.over).toBe(true);
  });

  it("reports over as null and the cap as null when no cap is set, never false", () => {
    latestPrompt(50_000);

    expect(promptSizeOf(SESSION, TRANSCRIPT, undefined)).toEqual({
      session: SESSION,
      prompt: 50_000,
      cap: null,
      over: null,
    });
  });

  it("returns nothing when the transcript holds no request, never a size of zero", () => {
    vi.mocked(advanceSplit).mockReturnValue({ offset: 0, models: [] });

    expect(promptSizeOf(SESSION, TRANSCRIPT, 80_000)).toBeUndefined();
  });
});

describe("promptLineOf", () => {
  it("prints the session, the prompt, the cap and over, on one line", () => {
    expect(
      promptLineOf({
        session: SESSION,
        prompt: 183_204,
        cap: 80_000,
        over: true,
      }),
    ).toBe(`session ${SESSION}: prompt 183204, cap 80000, over\n`);
  });

  it("prints not over for a prompt under the cap", () => {
    expect(
      promptLineOf({
        session: SESSION,
        prompt: 50_000,
        cap: 80_000,
        over: false,
      }),
    ).toBe(`session ${SESSION}: prompt 50000, cap 80000, not over\n`);
  });

  it("prints the cap as not set, never under the cap, when no cap is set", () => {
    expect(
      promptLineOf({ session: SESSION, prompt: 50_000, cap: null, over: null }),
    ).toBe(`session ${SESSION}: prompt 50000, cap not set\n`);
  });
});

describe("promptJsonOf", () => {
  it("prints the same fields as the line, as one JSON object", () => {
    expect(
      promptJsonOf({
        session: SESSION,
        prompt: 183_204,
        cap: 80_000,
        over: true,
      }),
    ).toBe(
      `{"session":"${SESSION}","prompt":183204,"cap":80000,"over":true}\n`,
    );
  });

  it("prints null for the cap and over when no cap is set", () => {
    expect(
      promptJsonOf({ session: SESSION, prompt: 50_000, cap: null, over: null }),
    ).toBe(`{"session":"${SESSION}","prompt":50000,"cap":null,"over":null}\n`);
  });
});
