import { describe, expect, it } from "vitest";
import { addSpend, NO_SPEND } from "./writing-spend.js";

describe("addSpend", () => {
  it("sums tokens and dollars", () => {
    expect(
      addSpend(
        { tokens: 100, dollars: 0.5, unpriced: [] },
        { tokens: 250, dollars: 1.25, unpriced: [] },
      ),
    ).toEqual({ tokens: 350, dollars: 1.75, unpriced: [] });
  });

  it("joins the unpriced models, sorted and each once", () => {
    expect(
      addSpend(
        { tokens: 1, dollars: 0, unpriced: ["zeta", "beta"] },
        { tokens: 1, dollars: 0, unpriced: ["beta", "alpha"] },
      ).unpriced,
    ).toEqual(["alpha", "beta", "zeta"]);
  });

  it("leaves a spend as it is when it is added to no spend", () => {
    const spend = { tokens: 7, dollars: 0.7, unpriced: ["zeta"] };

    expect(addSpend(NO_SPEND, spend)).toEqual(spend);
  });

  it("does not change the spends it adds", () => {
    const a = { tokens: 1, dollars: 1, unpriced: ["b"] };

    addSpend(a, { tokens: 1, dollars: 1, unpriced: ["a"] });

    expect(a).toEqual({ tokens: 1, dollars: 1, unpriced: ["b"] });
  });
});
