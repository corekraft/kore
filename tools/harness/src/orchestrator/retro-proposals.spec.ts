import { describe, expect, it } from "vitest";
import {
  PROPOSALS_BEGIN,
  PROPOSALS_END,
  RETRO_CAP,
  checkBatch,
  contentOf,
  readProposals,
  type Proposal,
} from "./retro-proposals.js";

const METRICS = ["friction.total", "rework.sendBacksPerIdea"];
const SAFETY = ["no-behaviour-change", "feature-flagged"];

const good: Proposal = {
  title: "Cut send-backs",
  hypothesis: "A clearer brief cuts send-backs",
  expectedOutcome: "Fewer send-backs per idea",
  measurement: "rework.sendBacksPerIdea over 14d",
  safetyPattern: "no-behaviour-change",
  metric: "friction.total",
  direction: "down",
  window: "14d",
};

const check = (batch: unknown) => checkBatch(batch, METRICS, SAFETY);

describe("readProposals", () => {
  it("reads the JSON between the last pair of markers in the pane", () => {
    const pane = `${PROPOSALS_BEGIN}\n[]\n${PROPOSALS_END}\nmore\n  ● ${PROPOSALS_BEGIN}\n[{"a":1}]\n  ${PROPOSALS_END}\nRESULT: done`;

    expect(readProposals(pane)).toEqual({ ok: true, batch: [{ a: 1 }] });
  });

  it("says where the markers belong when the pane printed none", () => {
    expect(readProposals("RESULT: done")).toEqual({
      ok: false,
      error: expect.stringContaining(PROPOSALS_BEGIN),
    });
  });

  it("refuses text between the markers that is not JSON", () => {
    expect(
      readProposals(`${PROPOSALS_BEGIN}\nnot json\n${PROPOSALS_END}`),
    ).toEqual({ ok: false, error: expect.stringContaining("not valid JSON") });
  });
});

describe("checkBatch", () => {
  it("accepts a batch of valid proposals, and an empty one", () => {
    expect(check([good])).toEqual({ ok: true, proposals: [good] });
    expect(check([])).toEqual({ ok: true, proposals: [] });
  });

  it("refuses everything when the batch is not an array", () => {
    expect(check({ title: "x" })).toEqual({
      ok: false,
      error: expect.stringContaining("array"),
    });
  });

  it("names the bad item and field, and refuses the whole batch", () => {
    const result = check([good, { ...good, direction: "sideways" }]);

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/Proposal 2.*direction/),
    });
  });

  it.each([
    ["a missing field", { ...good, title: undefined }, "title"],
    ["a non-string field", { ...good, hypothesis: 3 }, "hypothesis"],
    ["an unknown field", { ...good, extra: "x" }, "extra"],
    ["a frontmatter-breaking start", { ...good, title: "- x" }, "title"],
    [
      "a too-long field",
      { ...good, measurement: "x".repeat(501) },
      "measurement",
    ],
    ["an unknown metric", { ...good, metric: "nope" }, "metric"],
    [
      "an unknown safety pattern",
      { ...good, safetyPattern: "yolo" },
      "safetyPattern",
    ],
    ["a bad window", { ...good, window: "soon" }, "window"],
  ])("refuses %s", (_, item, field) => {
    expect(check([item])).toEqual({
      ok: false,
      error: expect.stringContaining(field),
    });
  });

  it("refuses a non-object item", () => {
    expect(check(["x"])).toMatchObject({ ok: false });
  });

  it("caps one retro at 5 proposals", () => {
    expect(RETRO_CAP).toBe(5);
  });
});

describe("contentOf", () => {
  it("is the same text for the same proposal and differs when any field differs", () => {
    expect(contentOf(good)).toBe(contentOf({ ...good }));
    expect(contentOf(good)).not.toBe(contentOf({ ...good, window: "7d" }));
  });
});
