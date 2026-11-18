import { describe, expect, it } from "vitest";
import { ASOF, WINDOW } from "./writer-cost-support.js";
import { writerFiguresIn } from "./writer-figures.js";

describe("writer figures: the cost and the arms read against one minimum", () => {
  it("gives the arms the minimum merged changes the cost settings give", () => {
    const figures = writerFiguresIn([], WINDOW, {
      asOf: ASOF,
      cost: { minMergedChanges: 3 },
    });

    expect(figures.writerCost.minMergedChanges).toBe(3);
    expect(figures.writerArms.minMergedChanges).toBe(3);
  });

  it("falls back to the default minimum when the cost settings leave it out", () => {
    const figures = writerFiguresIn([], WINDOW, { asOf: ASOF });

    expect(figures.writerCost.minMergedChanges).toBe(5);
    expect(figures.writerArms.minMergedChanges).toBe(5);
  });

  it("reads no arm with no merged change, as not read and never as a zero", () => {
    const figures = writerFiguresIn([], WINDOW, { asOf: ASOF });

    expect(figures.writerArms.overall).toMatchObject({
      status: "insufficient merged changes",
      haiku: { mergedChanges: 0, allInPerMergedChange: null },
      sonnet: { mergedChanges: 0, allInPerMergedChange: null },
    });
  });

  it("gives the arms the window effort it is handed, as the setting", () => {
    const figures = writerFiguresIn([], WINDOW, {
      asOf: ASOF,
      windowEffort: "medium",
    });

    expect(figures.writerArms.windowEffort).toEqual({
      effort: "medium",
      from: "setting",
    });
  });

  it("leaves the window effort to the arms' default when none is handed, and reads none from an empty ledger", () => {
    const figures = writerFiguresIn([], WINDOW, { asOf: ASOF });

    expect(figures.writerArms.windowEffort).toEqual({
      effort: null,
      from: "none",
    });
  });
});
