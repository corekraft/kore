import { describe, expect, it } from "vitest";
import { KINDS, parseEvent } from "./schema.js";

const base = {
  source: "claude",
  kind: "token.split",
  occurredAt: "2026-01-02T03:04:05.000Z",
  session: "s1",
};

/** A complete reading: every count present, as the stop hook writes it. */
const reading = {
  ...base,
  model: "claude-haiku-5-5",
  firstPrompt: 20498,
  largestPrompt: 250040,
  overCap: 3,
  lowRequests: 40,
  lowInput: 1000,
  lowCacheWrite5m: 0,
  lowCacheWrite1h: 300,
  lowCacheRead: 90000,
  lowOutput: 700,
  highRequests: 3,
  highInput: 0,
  highCacheWrite5m: 0,
  highCacheWrite1h: 0,
  highCacheRead: 250000,
  highOutput: 40,
};

function rejected(input: unknown) {
  const result = parseEvent(input, "input");
  if (result.ok) {
    throw new Error("expected the event to be rejected");
  }
  return result;
}

describe("ledger event schema token split", () => {
  it("accepts a token split reading of numbers and a model name", () => {
    expect(parseEvent(reading, "input").ok).toBe(true);
    expect(KINDS).toContain("token.split");
  });

  it("accepts a reading with no over-cap count, which is how a session with no cap is recorded", () => {
    const { overCap: _overCap, ...withoutCap } = reading;
    expect(parseEvent(withoutCap, "input").ok).toBe(true);
  });

  it("requires the largest prompt, and checks the over-cap count when present", () => {
    const { largestPrompt: _largest, ...withoutLargest } = reading;
    expect(rejected(withoutLargest).field).toBe("largestPrompt");
    expect(rejected({ ...reading, overCap: -1 }).field).toBe("overCap");
    expect(rejected({ ...reading, overCap: 0.5 }).field).toBe("overCap");
    expect(rejected({ ...reading, largestPrompt: "250040" }).field).toBe(
      "largestPrompt",
    );
  });

  it("requires the model name", () => {
    const { model: _model, ...withoutModel } = reading;
    expect(rejected(withoutModel).field).toBe("model");
  });

  it("requires every count, each a whole number of zero or more", () => {
    expect(rejected({ ...reading, lowRequests: undefined }).field).toBe(
      "lowRequests",
    );
    expect(rejected({ ...reading, highCacheRead: -1 }).field).toBe(
      "highCacheRead",
    );
    expect(rejected({ ...reading, lowInput: 1.5 }).field).toBe("lowInput");
    expect(rejected({ ...reading, firstPrompt: "20498" }).field).toBe(
      "firstPrompt",
    );
  });

  it("refuses a model name the ledger would not hold, such as the synthetic marker", () => {
    expect(rejected({ ...reading, model: "<synthetic>" }).field).toBe("model");
  });

  it("refuses text, so no prompt or reply is stored", () => {
    expect(rejected({ ...reading, prompt: "Fix the bug" }).field).toBe(
      "prompt",
    );
  });

  it("refuses a count on any other kind, so the reading stays on its own kind", () => {
    const usage = { ...base, kind: "token.usage", tokens: 10 };
    expect(parseEvent({ ...usage, lowRequests: 1 }, "input")).toMatchObject({
      ok: false,
      field: "lowRequests",
    });
  });
});
