// What makes a model-tier change reversible and measurable enough to approve (#218).
import { describe, expect, it, vi } from "vitest";
import type { CostMetric } from "../flow/index.js";
import type { IdeaRecord } from "../idea/index.js";
import { tierRefusal } from "./qualify-tier.js";

vi.mock("../idea/index.js", () => ({
  TIER_COST_METRIC: "metrics.tokensPerIdea",
  TIER_GUARD_METRIC: "rework.sendBacksPerIdea",
  TIER_FIELDS: ["model", "effort"],
}));

const ok = { status: "ok" } as unknown as CostMetric;
const input = {
  known: ["metrics.tokensPerIdea", "rework.sendBacksPerIdea"],
  trailing: {
    "metrics.tokensPerIdea": ok,
    "rework.sendBacksPerIdea": ok,
  },
};
const hypothesis = (over: Record<string, unknown> = {}) =>
  ({
    metric: "metrics.tokensPerIdea",
    direction: "down",
    window: "14d",
    tier: {
      fields: ["model", "effort"],
      guardMetric: "rework.sendBacksPerIdea",
    },
    ...over,
  }) as NonNullable<IdeaRecord["harness"]>;

describe("tierRefusal", () => {
  it("has nothing to say about a harness idea that is not a tier change", () => {
    const { tier: _tier, ...plain } = hypothesis();
    expect(tierRefusal(plain, input)).toBeUndefined();
  });

  it("accepts a model and effort frontmatter edit measured on cost and send-backs", () => {
    expect(tierRefusal(hypothesis(), input)).toBeUndefined();
  });

  it("leaves a change that touches anything beyond frontmatter model or effort for a person", () => {
    expect(
      tierRefusal(
        hypothesis({
          tier: {
            fields: ["model", "tools"],
            guardMetric: "rework.sendBacksPerIdea",
          },
        }),
        input,
      ),
    ).toBe(
      "it declares a tier change touching tools; only model or effort in an agent definition's frontmatter is a reversible tier change.",
    );
  });

  it("leaves a tier change that declares only cost for a person, naming the missing send-backs metric", () => {
    expect(
      tierRefusal(
        hypothesis({ tier: { fields: ["model"], guardMetric: "" } }),
        input,
      ),
    ).toBe(
      "a tier change is measured on cost and judge send-backs together, and this one declares no guard metric (rework.sendBacksPerIdea).",
    );
  });
});

describe("tierRefusal on measurability", () => {
  it("leaves a tier change whose cost metric is not tokens per idea going down for a person", () => {
    expect(tierRefusal(hypothesis({ metric: "friction.total" }), input)).toBe(
      "a tier change's cost metric is metrics.tokensPerIdea expected to fall, not friction.total down.",
    );
    expect(tierRefusal(hypothesis({ direction: "up" }), input)).toBe(
      "a tier change's cost metric is metrics.tokensPerIdea expected to fall, not metrics.tokensPerIdea up.",
    );
  });

  it("leaves a tier change for a person when the flow report no longer names send-backs", () => {
    expect(
      tierRefusal(hypothesis(), { ...input, known: ["metrics.tokensPerIdea"] }),
    ).toBe(
      "rework.sendBacksPerIdea is not a metric of the flow report (see `harness flow report --json`), so send-backs cannot be compared.",
    );
  });

  it("leaves a tier change with no send-backs history to compare against for a person", () => {
    expect(
      tierRefusal(hypothesis(), {
        ...input,
        trailing: { "metrics.tokensPerIdea": ok },
      }),
    ).toBe(
      "rework.sendBacksPerIdea is in the flow report but has no trailing average to compare send-backs against.",
    );
    expect(
      tierRefusal(hypothesis(), {
        ...input,
        trailing: {
          "metrics.tokensPerIdea": ok,
          "rework.sendBacksPerIdea": {
            status: "insufficient history",
            closedIdeas: 1,
            needed: 5,
          } as CostMetric,
        },
      }),
    ).toBe(
      "rework.sendBacksPerIdea has too little history to compare send-backs against (1 closed ideas, 5 needed).",
    );
  });
});
