import { describe, expect, it } from "vitest";
import { EMPTY_REPORT_FIELDS } from "./flow-empty-cost-waiting.js";

describe("empty report fields: nothing read beyond the shared fixture", () => {
  it("holds an insufficient merged-change level and an insufficient writing share with no agent, idea or change, never a zero share", () => {
    expect(EMPTY_REPORT_FIELDS.costWaiting).toEqual({
      agents: {},
      ideas: [],
      mergedChanges: {
        changes: [],
        status: "insufficient",
        joined: 0,
        needed: 5,
      },
      writing: {
        attributed: { sessions: 0, tokens: 0, dollars: 0 },
        noIdea: { sessions: 0, tokens: 0, dollars: 0 },
        noPullRequest: { sessions: 0, tokens: 0, dollars: 0 },
        unjoinable: 0,
        share: { status: "insufficient", sessions: 0, needed: 5 },
      },
    });
  });

  it("holds the owner questions with no question and a null per-merged rate", () => {
    expect(EMPTY_REPORT_FIELDS.ownerQuestions).toEqual({
      trailingDays: 7,
      questions: 0,
      merged: 0,
      perMerged: null,
      trailingAverage: null,
      worsened: false,
    });
  });
});
