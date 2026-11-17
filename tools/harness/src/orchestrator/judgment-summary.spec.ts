import { describe, expect, it } from "vitest";
import { SUMMARY_MAX, readSummary } from "./judgment-summary.js";

const NONE =
  "The reader printed no summary between SUMMARY-BEGIN and SUMMARY-END.";

describe("readSummary", () => {
  it("returns the text between the last pair of summary markers", () => {
    const pane = [
      "SUMMARY-BEGIN",
      "old answer",
      "SUMMARY-END",
      "more output",
      "● SUMMARY-BEGIN",
      "Question: where is the tick",
      "- tick.ts:12",
      "SUMMARY-END",
    ].join("\n");

    expect(readSummary(pane)).toBe("Question: where is the tick\n- tick.ts:12");
  });

  it("drops any RESULT line inside the summary, so a summary cannot end a wait early", () => {
    const pane = [
      "SUMMARY-BEGIN",
      "- found it",
      "RESULT: done",
      "SUMMARY-END",
    ].join("\n");

    expect(readSummary(pane)).toBe("- found it");
  });

  it("reads no summary from a marker written inside a sentence", () => {
    expect(readSummary("print SUMMARY-BEGIN then SUMMARY-END when done")).toBe(
      NONE,
    );
  });

  it("says so when the pane printed no summary", () => {
    expect(readSummary("nothing printed here")).toBe(NONE);
  });

  it("caps a long summary at SUMMARY_MAX characters and says it was cut", () => {
    const long = "x".repeat(SUMMARY_MAX + 500);
    const pane = `SUMMARY-BEGIN\n${long}\nSUMMARY-END`;

    expect(readSummary(pane)).toBe(
      `${"x".repeat(SUMMARY_MAX)}\n(cut at ${SUMMARY_MAX} characters)`,
    );
  });
});
