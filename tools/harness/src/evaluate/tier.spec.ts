// A model-tier change (#218) is judged on cost and judge send-backs together.
import { describe, expect, it } from "vitest";
import type { Judgement } from "./judge.js";
import { judgeTier } from "./tier.js";

const COST_DOWN: Judgement = {
  result: "confirmed",
  change: -0.3,
  reason: "moved down 30%",
};
const GUARD = "rework.sendBacksPerIdea";
const flat = { before: 2, after: 2 };

const judged = (
  cost: Judgement,
  guard: Judgement,
  figures: { before: number | null; after: number | null },
) =>
  judgeTier({
    cost,
    guard: { ...figures, judgement: guard },
    guardMetric: GUARD,
  });

describe("judgeTier", () => {
  it("confirms a cost saving whose send-backs stayed flat", () => {
    expect(
      judged(
        COST_DOWN,
        { result: "inconclusive", change: 0, reason: "x" },
        flat,
      ),
    ).toEqual({
      result: "confirmed",
      change: -0.3,
      reason: `moved down 30%; ${GUARD} stayed within the noise threshold (2 to 2)`,
    });
  });

  it("confirms a cost saving whose send-backs fell", () => {
    expect(
      judged(
        COST_DOWN,
        { result: "confirmed", change: -0.5, reason: "x" },
        { before: 2, after: 1 },
      ).result,
    ).toBe("confirmed");
  });
});

describe("judgeTier on rising send-backs", () => {
  it("refutes a cost saving bought with send-backs up past the threshold", () => {
    expect(
      judged(
        COST_DOWN,
        { result: "refuted", change: 0.5, reason: "x" },
        { before: 2, after: 3 },
      ),
    ).toEqual({
      result: "refuted",
      change: -0.3,
      reason: `moved down 30%, but ${GUARD} rose from 2 to 3 past the threshold`,
    });
  });

  it("refutes a saving when send-backs rose from none, which a relative change cannot show", () => {
    expect(
      judged(
        COST_DOWN,
        {
          result: "inconclusive",
          change: null,
          reason: "insufficient history",
        },
        { before: 0, after: 1 },
      ).result,
    ).toBe("refuted");
  });

  it("never refutes a saving when send-backs are still none", () => {
    expect(
      judged(
        COST_DOWN,
        {
          result: "inconclusive",
          change: null,
          reason: "insufficient history",
        },
        { before: 0, after: 0 },
      ).result,
    ).toBe("confirmed");
  });
});

describe("judgeTier without a comparison", () => {
  it("is inconclusive when there is no send-backs figure to hold the saving against", () => {
    expect(
      judged(
        COST_DOWN,
        {
          result: "inconclusive",
          change: null,
          reason: "insufficient history",
        },
        { before: null, after: 3 },
      ),
    ).toEqual({
      result: "inconclusive",
      change: -0.3,
      reason: `moved down 30%, but ${GUARD} has no figure before and after to judge it against`,
    });
  });

  it("leaves a cost that did not fall as its own judgement, whatever the send-backs did", () => {
    const up: Judgement = {
      result: "refuted",
      change: 0.2,
      reason: "moved up 20%",
    };
    expect(
      judged(
        up,
        { result: "confirmed", change: -0.5, reason: "x" },
        { before: 2, after: 1 },
      ),
    ).toBe(up);
  });
});
